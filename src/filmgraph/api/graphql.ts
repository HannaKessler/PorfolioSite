import { createSchema, createYoga, maskError as yogaMaskError, type YogaServerInstance } from "graphql-yoga";
import { GraphQLError } from "graphql";
import { usePersistedOperations } from "@graphql-yoga/plugin-persisted-operations";
import typeDefs from "./schema.graphql?raw";
import type { Db, SqlEvent } from "../db/database";
import {
  ApiError,
  MAX_HOPS,
  actorPath,
  allGenres,
  countFilms,
  listFilms,
  searchNamed,
  sharedFilms,
  studioFilmCount,
  studioGenreBreakdown,
  type CreditRow,
  type FilmFilter,
  type FilmOrder,
  type Role,
} from "../db/access";
import { createLoaders, type Loaders } from "./loaders";
import { optionalId, parseId } from "./ids";
import type { Resolvers, FilmFilter as GqlFilmFilter } from "./generated";
import { PERSISTED_ONLY_HEADER } from "../config";

export interface ServerContext {
  trace: SqlEvent[];
  batching: boolean;
}

export interface GraphQLContext extends ServerContext {
  db: Db;
  loaders: Loaders;
}

const role = (value: string | null | undefined): Role | null => (value ? (value.toLowerCase() as Role) : null);
const order = (value: string | null | undefined): FilmOrder => (value ?? "POPULARITY").toLowerCase() as FilmOrder;
const filterOf = (filter: GqlFilmFilter | null | undefined): FilmFilter => ({
  search: filter?.search ?? null,
  genreId: optionalId(filter?.genre, "genre"),
  studioId: optionalId(filter?.studio, "studio"),
  yearFrom: filter?.yearFrom ?? null,
  yearTo: filter?.yearTo ?? null,
});
const byRole = (credits: CreditRow[], value: string | null | undefined) => {
  const wanted = role(value);
  return wanted ? credits.filter((credit) => credit.role === wanted) : credits;
};
function must<T>(value: T | null | Error, what: string): T {
  if (value === null || value instanceof Error) throw new ApiError("NOT_FOUND", `${what} not found.`);
  return value;
}

export const resolvers: Resolvers<GraphQLContext> = {
  Query: {
    film: (_, { id }, { loaders }) => loaders.film.load(parseId(id)),
    films: async (_, { filter, orderBy, first, after }, { db }) => {
      const parsed = filterOf(filter);
      return { page: await listFilms(db, parsed, { first, after, orderBy: order(orderBy) }), filter: parsed };
    },
    person: (_, { id }, { loaders }) => loaders.person.load(parseId(id)),
    people: (_, { search, first, after }, { db }) => searchNamed(db, "person", search, { first, after }),
    studio: (_, { id }, { loaders }) => loaders.studio.load(parseId(id)),
    studios: (_, { search, first, after }, { db }) => searchNamed(db, "studio", search, { first, after }),
    genre: (_, { id }, { loaders }) => loaders.genre.load(parseId(id)),
    genres: (_, __, { db }) => allGenres(db),
    sharedFilms: (_, { personA, personB, role: wanted }, { db }) =>
      sharedFilms(db, parseId(personA, "personA"), parseId(personB, "personB"), role(wanted)),
    actorPath: async (_, { from, to, maxHops }, { db }) => {
      const steps = await actorPath(db, parseId(from, "from"), parseId(to, "to"), maxHops ?? MAX_HOPS);
      return steps ? { hops: steps.length, steps } : null;
    },
  },
  Film: {
    credits: async (film, { role: wanted }, { loaders }) => byRole(await loaders.creditsByFilm.load(film.id), wanted),
    directors: async (film, _, { loaders }) => {
      const credits = byRole(await loaders.creditsByFilm.load(film.id), "DIRECTOR");
      const people = await loaders.person.loadMany(credits.map((credit) => credit.personId));
      return people.map((person) => must(person, "Person"));
    },
    genres: (film, _, { loaders }) => loaders.genresByFilm.load(film.id),
    studios: (film, _, { loaders }) => loaders.studiosByFilm.load(film.id),
  },
  Person: {
    credits: async (person, { role: wanted }, { loaders }) =>
      byRole(await loaders.creditsByPerson.load(person.id), wanted),
    creditsByDecade: async (person, { role: wanted }, { loaders }) => {
      const credits = byRole(await loaders.creditsByPerson.load(person.id), wanted);
      const films = await loaders.film.loadMany(credits.map((credit) => credit.filmId));
      const groups = new Map<number, CreditRow[]>();
      credits.forEach((credit, index) => {
        const film = must(films[index], "Film");
        const decade = Math.floor(film.year / 10) * 10;
        groups.set(decade, [...(groups.get(decade) ?? []), credit]);
      });
      return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([decade, list]) => ({ decade, credits: list }));
    },
  },
  Credit: {
    role: (credit) => credit.role.toUpperCase() as "ACTOR" | "DIRECTOR" | "WRITER",
    film: async (credit, _, { loaders }) => must(await loaders.film.load(credit.filmId), "Film"),
    person: async (credit, _, { loaders }) => must(await loaders.person.load(credit.personId), "Person"),
  },
  Studio: {
    filmCount: (studio, _, { db }) => studioFilmCount(db, studio.id),
    films: async (studio, { filter, orderBy, first, after }, { db }) => {
      const parsed = { ...filterOf(filter), studioId: studio.id };
      return { page: await listFilms(db, parsed, { first, after, orderBy: order(orderBy) }), filter: parsed };
    },
    genreBreakdown: async (studio, _, { db }) =>
      (await studioGenreBreakdown(db, studio.id)).map((row) => ({
        decade: row.decade,
        count: row.count,
        genre: { id: row.genreId, name: row.genreName, wikidataId: `Q${row.genreId}` },
      })),
  },
  Genre: {
    filmCount: (genre, _, { db }) =>
      "filmCount" in genre && typeof genre.filmCount === "number" ? genre.filmCount : countFilms(db, { genreId: genre.id }),
    films: async (genre, { orderBy, first, after }, { db }) => {
      const parsed = { genreId: genre.id };
      return { page: await listFilms(db, parsed, { first, after, orderBy: order(orderBy) }), filter: parsed };
    },
  },
  FilmConnection: {
    edges: ({ page }) => page.rows.map((node, index) => ({ cursor: page.cursors[index], node })),
    pageInfo: ({ page }) => ({ hasNextPage: page.hasNextPage, endCursor: page.endCursor }),
    totalCount: ({ filter }, _, { db }) => countFilms(db, filter),
  },
  PersonConnection: {
    edges: (page) => page.rows.map((node, index) => ({ cursor: page.cursors[index], node })),
    pageInfo: (page) => ({ hasNextPage: page.hasNextPage, endCursor: page.endCursor }),
  },
  StudioConnection: {
    edges: (page) => page.rows.map((node, index) => ({ cursor: page.cursors[index], node })),
    pageInfo: (page) => ({ hasNextPage: page.hasNextPage, endCursor: page.endCursor }),
  },
  PathStep: {
    from: async (step, _, { loaders }) => must(await loaders.person.load(step.fromId), "Person"),
    film: async (step, _, { loaders }) => must(await loaders.film.load(step.filmId), "Film"),
    to: async (step, _, { loaders }) => must(await loaders.person.load(step.toId), "Person"),
  },
};

export const typeDefsSource = typeDefs;

export interface GraphQLOptions {
  db: Db;
  endpoint: string;
  /** sha256 hex hash -> query text, bundled at build time. */
  persisted: Map<string, string>;
}


export function createGraphQL({ db, endpoint, persisted }: GraphQLOptions): YogaServerInstance<ServerContext, GraphQLContext> {
  return createYoga<ServerContext, GraphQLContext>({
    graphqlEndpoint: endpoint,
    graphiql: false,
    landingPage: false,
    // Expected client errors (bad IDs, unknown persisted queries) are part of the
    // response; only log genuinely unexpected failures.
    logging: {
      debug: () => undefined,
      info: () => undefined,
      warn: (...args: unknown[]) => console.warn(...args),
      error: (...args: unknown[]) => {
        if (args.some((arg) => arg instanceof ApiError || (arg as GraphQLError)?.originalError instanceof ApiError)) return;
        console.error(...args);
      },
    },
    schema: createSchema<GraphQLContext>({ typeDefs, resolvers: resolvers as never }),
    context: ({ trace, batching }) => {
      const traced = db.withTrace(trace);
      return { trace, batching, db: traced, loaders: createLoaders(traced, batching) };
    },
    maskedErrors: {
      maskError(error, message, isDev) {
        const original = (error as GraphQLError).originalError;
        if (original instanceof ApiError) {
          return new GraphQLError(original.message, {
            nodes: (error as GraphQLError).nodes,
            path: (error as GraphQLError).path,
            extensions: { code: original.code },
          });
        }
        return yogaMaskError(error, message, isDev);
      },
    },
    plugins: [
      usePersistedOperations({
        getPersistedOperation: (hash: string) => persisted.get(hash) ?? null,
        allowArbitraryOperations: (request: Request) => request.headers.get(PERSISTED_ONLY_HEADER) !== "on",
      }),
    ],
  });
}
