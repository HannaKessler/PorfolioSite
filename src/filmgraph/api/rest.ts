/**
 * REST API over the same data-access layer as GraphQL.
 * Resources are full representations (what a typical REST API returns), lists
 * use the same keyset cursors as GraphQL, and every 200 carries a strong ETag.
 */
import type { Db } from "../db/database";
import {
  ApiError,
  MAX_HOPS,
  actorPath,
  allGenres,
  byId,
  countFilms,
  creditsByFilmIds,
  creditsByPersonIds,
  filmsByIds,
  genresByFilmIds,
  genresByIds,
  groupBy,
  listFilms,
  peopleByIds,
  filmCountsByStudioIds,
  knownForByPersonIds,
  knownForByStudioIds,
  searchNames,
  studioFilmCount,
  studiosByFilmIds,
  studiosByIds,
  type FilmFilter,
  type FilmOrder,
  type FilmRow,
  type Role,
} from "../db/access";
import { optionalId, parseId } from "./ids";

type Params = Record<string, string>;
type Handler = (db: Db, params: Params, query: URLSearchParams) => Promise<unknown>;

export function createRest(basePath: string) {
  const href = (path: string) => `${basePath}${path}`;
  const ref = (kind: "films" | "people" | "studios" | "genres", id: number) => href(`/${kind}/${id}`);

  const intParam = (query: URLSearchParams, key: string): number | null => {
    const value = query.get(key);
    if (value === null || value === "") return null;
    if (!/^-?\d+$/.test(value)) throw new ApiError("BAD_USER_INPUT", `${key} must be a whole number.`);
    return Number(value);
  };
  const roleParam = (query: URLSearchParams): Role | null => {
    const value = query.get("role");
    if (!value) return null;
    if (!["actor", "director", "writer"].includes(value)) {
      throw new ApiError("BAD_USER_INPUT", "role must be actor, director or writer.");
    }
    return value as Role;
  };
  const orderParam = (query: URLSearchParams, fallback: FilmOrder): FilmOrder => {
    const value = query.get("orderBy") ?? fallback;
    if (!["popularity", "year", "title"].includes(value)) {
      throw new ApiError("BAD_USER_INPUT", "orderBy must be popularity, year or title.");
    }
    return value as FilmOrder;
  };
  const filterParams = (query: URLSearchParams): FilmFilter => ({
    search: query.get("search"),
    genreId: optionalId(query.get("genre"), "genre"),
    studioId: optionalId(query.get("studio"), "studio"),
    yearFrom: intParam(query, "yearFrom"),
    yearTo: intParam(query, "yearTo"),
  });

  /** Full film representations with their genres and studios embedded. */
  async function filmResources(db: Db, films: FilmRow[]) {
    const ids = films.map((film) => film.id);
    const [genres, studios] = ids.length
      ? await Promise.all([genresByFilmIds(db, ids), studiosByFilmIds(db, ids)])
      : [[], []];
    const genreLists = groupBy(ids, genres, (row) => row.filmId);
    const studioLists = groupBy(ids, studios, (row) => row.filmId);
    return films.map((film, index) => ({
      id: film.id,
      title: film.title,
      year: film.year,
      runtime: film.runtime,
      country: film.country,
      description: film.description,
      wikidataId: film.wikidataId,
      popularity: film.popularity,
      genres: genreLists[index].map(({ id, name }) => ({ id, name, href: ref("genres", id) })),
      studios: studioLists[index].map(({ id, name }) => ({ id, name, href: ref("studios", id) })),
      links: { self: ref("films", film.id), credits: `${ref("films", film.id)}/credits` },
    }));
  }

  async function filmList(db: Db, filter: FilmFilter, query: URLSearchParams, fallbackOrder: FilmOrder) {
    const limit = intParam(query, "limit") ?? 20;
    const page = await listFilms(db, filter, {
      first: limit,
      after: query.get("cursor"),
      orderBy: orderParam(query, fallbackOrder),
    });
    return {
      data: await filmResources(db, page.rows),
      page: { limit, nextCursor: page.hasNextPage ? page.endCursor : null, total: await countFilms(db, filter) },
    };
  }

  async function found<T>(promise: Promise<(T | null)[]>, what: string): Promise<T> {
    const [row] = await promise;
    if (!row) throw new ApiError("NOT_FOUND", `${what} not found.`);
    return row;
  }

  /** Short film references keyed by the owner id, for "known for" details. */
  async function filmRefs(db: Db, pairs: { id: number; filmId: number }[]) {
    const films = pairs.length ? await filmsByIds(db, [...new Set(pairs.map((pair) => pair.filmId))]) : [];
    const byFilm = new Map(films.map((film) => [film.id, film]));
    return new Map(
      pairs.map((pair) => {
        const film = byFilm.get(pair.filmId)!;
        return [pair.id, { id: film.id, title: film.title, year: film.year, href: ref("films", film.id) }];
      }),
    );
  }

  const routes: [RegExp, Handler][] = [
    [/^\/films$/, (db, _, query) => filmList(db, filterParams(query), query, "popularity")],
    [
      /^\/films\/(?<id>[^/]+)$/,
      async (db, { id }) => {
        const film = await found(filmsByIds(db, [parseId(id)]).then((rows) => byId([parseId(id)], rows)), "Film");
        return (await filmResources(db, [film]))[0];
      },
    ],
    [
      /^\/films\/(?<id>[^/]+)\/credits$/,
      async (db, { id }, query) => {
        const filmId = parseId(id);
        await found(filmsByIds(db, [filmId]).then((rows) => byId([filmId], rows)), "Film");
        const wanted = roleParam(query);
        const credits = (await creditsByFilmIds(db, [filmId])).filter((c) => !wanted || c.role === wanted);
        const people = byId(
          credits.map((c) => c.personId),
          credits.length ? await peopleByIds(db, [...new Set(credits.map((c) => c.personId))]) : [],
        );
        return {
          data: credits.map((credit, index) => ({
            role: credit.role,
            character: credit.character,
            billingOrder: credit.billingOrder,
            person: { id: credit.personId, name: people[index]?.name ?? null, href: ref("people", credit.personId) },
          })),
        };
      },
    ],
    [
      /^\/people$/,
      async (db, _, query) => {
        const search = query.get("search");
        if (!search) throw new ApiError("BAD_USER_INPUT", "search is required.");
        const limit = intParam(query, "limit") ?? 10;
        const wanted = roleParam(query);
        const page = await searchNames(db, "person", search, { role: wanted, first: limit, after: query.get("cursor") });
        const ids = page.rows.map((person) => person.id);
        const knownFor = ids.length ? await knownForByPersonIds(db, ids, wanted) : [];
        const films = await filmRefs(db, knownFor);
        return {
          data: page.rows.map((person) => ({
            ...person,
            knownFor: films.get(person.id) ?? null,
            links: { self: ref("people", person.id) },
          })),
          page: { limit, nextCursor: page.hasNextPage ? page.endCursor : null },
        };
      },
    ],
    [
      /^\/people\/(?<id>[^/]+)$/,
      async (db, { id }) => {
        const personId = parseId(id);
        const person = await found(peopleByIds(db, [personId]).then((rows) => byId([personId], rows)), "Person");
        return { ...person, links: { self: ref("people", person.id), films: `${ref("people", person.id)}/films` } };
      },
    ],
    [
      /^\/people\/(?<id>[^/]+)\/films$/,
      async (db, { id }, query) => {
        const personId = parseId(id);
        await found(peopleByIds(db, [personId]).then((rows) => byId([personId], rows)), "Person");
        const wanted = roleParam(query);
        const credits = (await creditsByPersonIds(db, [personId])).filter((c) => !wanted || c.role === wanted);
        const films = byId(
          credits.map((c) => c.filmId),
          credits.length ? await filmsByIds(db, [...new Set(credits.map((c) => c.filmId))]) : [],
        );
        return {
          data: credits.map((credit, index) => ({
            role: credit.role,
            character: credit.character,
            billingOrder: credit.billingOrder,
            film: {
              id: credit.filmId,
              title: films[index]?.title ?? null,
              year: films[index]?.year ?? null,
              href: ref("films", credit.filmId),
            },
          })),
        };
      },
    ],
    [
      /^\/studios$/,
      async (db, _, query) => {
        const search = query.get("search");
        if (!search) throw new ApiError("BAD_USER_INPUT", "search is required.");
        const limit = intParam(query, "limit") ?? 10;
        const page = await searchNames(db, "studio", search, { first: limit, after: query.get("cursor") });
        const ids = page.rows.map((studio) => studio.id);
        const [counts, knownFor] = ids.length
          ? await Promise.all([filmCountsByStudioIds(db, ids), knownForByStudioIds(db, ids)])
          : [[], []];
        const countOf = new Map(counts.map((row) => [row.id, row.count]));
        const films = await filmRefs(db, knownFor);
        return {
          data: page.rows.map((studio) => ({
            ...studio,
            filmCount: countOf.get(studio.id) ?? 0,
            knownFor: films.get(studio.id) ?? null,
            links: { self: ref("studios", studio.id), films: `${ref("studios", studio.id)}/films` },
          })),
          page: { limit, nextCursor: page.hasNextPage ? page.endCursor : null },
        };
      },
    ],
    [
      /^\/studios\/(?<id>[^/]+)$/,
      async (db, { id }) => {
        const studioId = parseId(id);
        const studio = await found(studiosByIds(db, [studioId]).then((rows) => byId([studioId], rows)), "Studio");
        return {
          ...studio,
          filmCount: await studioFilmCount(db, studioId),
          links: { self: ref("studios", studioId), films: `${ref("studios", studioId)}/films` },
        };
      },
    ],
    [
      /^\/studios\/(?<id>[^/]+)\/films$/,
      async (db, { id }, query) => {
        const studioId = parseId(id);
        await found(studiosByIds(db, [studioId]).then((rows) => byId([studioId], rows)), "Studio");
        return filmList(db, { ...filterParams(query), studioId }, query, "year");
      },
    ],
    [
      /^\/genres$/,
      async (db) => ({
        data: (await allGenres(db)).map((genre) => ({ ...genre, links: { self: ref("genres", genre.id) } })),
      }),
    ],
    [
      /^\/genres\/(?<id>[^/]+)$/,
      async (db, { id }) => {
        const genreId = parseId(id);
        const genre = await found(genresByIds(db, [genreId]).then((rows) => byId([genreId], rows)), "Genre");
        return {
          ...genre,
          filmCount: await countFilms(db, { genreId }),
          links: { self: ref("genres", genreId), films: `${ref("genres", genreId)}/films` },
        };
      },
    ],
    [
      /^\/genres\/(?<id>[^/]+)\/films$/,
      async (db, { id }, query) => {
        const genreId = parseId(id);
        await found(genresByIds(db, [genreId]).then((rows) => byId([genreId], rows)), "Genre");
        return filmList(db, { ...filterParams(query), genreId }, query, "popularity");
      },
    ],
    [
      /^\/paths$/,
      async (db, _, query) => {
        const from = parseId(query.get("from") ?? "", "from");
        const to = parseId(query.get("to") ?? "", "to");
        const steps = await actorPath(db, from, to, intParam(query, "maxHops") ?? MAX_HOPS);
        if (!steps) return { data: null };
        const personIds = [...new Set(steps.flatMap((step) => [step.fromId, step.toId]))];
        const filmIds = [...new Set(steps.map((step) => step.filmId))];
        const [people, films] = steps.length
          ? await Promise.all([peopleByIds(db, personIds), filmsByIds(db, filmIds)])
          : [[], []];
        const person = new Map(people.map((row) => [row.id, row]));
        const film = new Map(films.map((row) => [row.id, row]));
        return {
          data: {
            hops: steps.length,
            steps: steps.map((step) => ({
              from: { id: step.fromId, name: person.get(step.fromId)?.name ?? null, href: ref("people", step.fromId) },
              film: {
                id: step.filmId,
                title: film.get(step.filmId)?.title ?? null,
                year: film.get(step.filmId)?.year ?? null,
                href: ref("films", step.filmId),
              },
              to: { id: step.toId, name: person.get(step.toId)?.name ?? null, href: ref("people", step.toId) },
            })),
          },
        };
      },
    ],
  ];

  /** Returns the JSON body and status for a REST path (relative to basePath). */
  async function handle(db: Db, method: string, path: string, query: URLSearchParams) {
    for (const [pattern, handler] of routes) {
      const match = pattern.exec(path);
      if (!match) continue;
      if (method !== "GET" && method !== "HEAD") {
        return { status: 405, body: { error: { code: "METHOD_NOT_ALLOWED", message: "This demo API is read-only." } }, allow: "GET, HEAD" };
      }
      const params = Object.fromEntries(
        Object.entries(match.groups ?? {}).map(([key, value]) => [key, decodeURIComponent(value)]),
      );
      try {
        return { status: 200, body: await handler(db, params, query) };
      } catch (error) {
        if (error instanceof ApiError) {
          return { status: error.status, body: { error: { code: error.code, message: error.message } } };
        }
        throw error;
      }
    }
    return { status: 404, body: { error: { code: "NOT_FOUND", message: `No route for ${path}.` } } };
  }

  return { handle };
}
