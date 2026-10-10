/**
 * Explorer presets. Each one pairs a GraphQL document with a REST plan: the
 * sequence of REST calls a client would make to build exactly the same data.
 * The contract tests run both and check they produce identical results.
 */
import {
  ACTOR_PATH,
  DIRECTOR_WITH_CAST,
  FILMOGRAPHY_BY_DECADE,
  SHARED_FILMS,
  SIX_DEGREES,
  STUDIO_OUTPUT,
} from "../operations";

/** GET a REST path relative to the REST base and return the parsed JSON body. */
export type RestGet = (path: string) => Promise<any>;

export interface Preset {
  id: string;
  label: string;
  summary: string;
  query: string;
  variables: Record<string, string>;
  /** Human-readable REST call sequence, shown before running. */
  restSteps: (variables: Record<string, string>) => string[];
  /** Runs the REST calls and assembles the same shape as GraphQL's `data`. */
  rest: (get: RestGet, variables: Record<string, string>) => Promise<unknown>;
}

const enc = encodeURIComponent;

export const PRESETS: Preset[] = [
  {
    id: "director",
    label: "Director with full cast",
    summary: "Every film Christopher Nolan directed, with each film's billed cast.",
    query: DIRECTOR_WITH_CAST,
    variables: { id: "25191" },
    restSteps: ({ id }) => [
      `GET /people/${id}`,
      `GET /people/${id}/films?role=director`,
      "GET /films/{filmId}/credits?role=actor  (one per film)",
    ],
    async rest(get, { id }) {
      const [person, films] = await Promise.all([
        get(`/people/${enc(id)}`),
        get(`/people/${enc(id)}/films?role=director`),
      ]);
      const casts = await Promise.all(
        films.data.map((credit: any) => get(`/films/${credit.film.id}/credits?role=actor`)),
      );
      return {
        person: {
          name: person.name,
          birthYear: person.birthYear,
          directed: films.data.map((credit: any, index: number) => ({
            film: {
              title: credit.film.title,
              year: credit.film.year,
              cast: casts[index].data.map((c: any) => ({
                billingOrder: c.billingOrder,
                character: c.character,
                person: { name: c.person.name },
              })),
            },
          })),
        },
      };
    },
  },
  {
    id: "filmography",
    label: "Filmography by decade",
    summary: "Tom Hanks's acting credits grouped by decade, with each film's genres.",
    query: FILMOGRAPHY_BY_DECADE,
    variables: { id: "2263" },
    restSteps: ({ id }) => [
      `GET /people/${id}`,
      `GET /people/${id}/films?role=actor`,
      "GET /films/{filmId}  (one per film, for genres)",
      "Group by decade in the client",
    ],
    async rest(get, { id }) {
      const [person, credits] = await Promise.all([
        get(`/people/${enc(id)}`),
        get(`/people/${enc(id)}/films?role=actor`),
      ]);
      const films = await Promise.all(credits.data.map((credit: any) => get(`/films/${credit.film.id}`)));
      const groups = new Map<number, unknown[]>();
      credits.data.forEach((credit: any, index: number) => {
        const film = films[index];
        const decade = Math.floor(film.year / 10) * 10;
        groups.set(decade, [
          ...(groups.get(decade) ?? []),
          {
            character: credit.character,
            film: { title: film.title, year: film.year, genres: film.genres.map((g: any) => ({ name: g.name })) },
          },
        ]);
      });
      return {
        person: {
          name: person.name,
          byDecade: [...groups.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([decade, list]) => ({ decade, credits: list })),
        },
      };
    },
  },
  {
    id: "shared",
    label: "Films two actors share",
    summary: "Films with both Robert De Niro and Al Pacino in the cast, and who directed them.",
    query: SHARED_FILMS,
    variables: { a: "36949", b: "41163" },
    restSteps: ({ a, b }) => [
      `GET /people/${a}`,
      `GET /people/${b}`,
      `GET /people/${a}/films?role=actor`,
      `GET /people/${b}/films?role=actor`,
      "Intersect the two lists in the client",
      "GET /films/{filmId}/credits?role=director  (one per shared film)",
    ],
    async rest(get, { a, b }) {
      const [personA, personB, filmsA, filmsB] = await Promise.all([
        get(`/people/${enc(a)}`),
        get(`/people/${enc(b)}`),
        get(`/people/${enc(a)}/films?role=actor`),
        get(`/people/${enc(b)}/films?role=actor`),
      ]);
      const inB = new Set(filmsB.data.map((credit: any) => credit.film.id));
      const seen = new Set<number>();
      const shared = filmsA.data
        .map((credit: any) => credit.film)
        .filter((film: any) => inB.has(film.id) && !seen.has(film.id) && seen.add(film.id));
      const directors = await Promise.all(shared.map((film: any) => get(`/films/${film.id}/credits?role=director`)));
      return {
        a: { name: personA.name },
        b: { name: personB.name },
        sharedFilms: shared.map((film: any, index: number) => ({
          title: film.title,
          year: film.year,
          directors: directors[index].data.map((credit: any) => ({ name: credit.person.name })),
        })),
      };
    },
  },
  {
    id: "studio",
    label: "Studio output by genre",
    summary: "Warner Bros. films per genre in each decade. GraphQL aggregates in SQL; REST pages through every film.",
    query: STUDIO_OUTPUT,
    variables: { id: "126399" },
    restSteps: ({ id }) => [
      `GET /studios/${id}`,
      `GET /studios/${id}/films?limit=100  (follow nextCursor until done)`,
      "Count genres per decade in the client",
    ],
    async rest(get, { id }) {
      const studio = await get(`/studios/${enc(id)}`);
      const films: any[] = [];
      let cursor: string | null = null;
      do {
        const page: any = await get(
          `/studios/${enc(id)}/films?limit=100${cursor ? `&cursor=${enc(cursor)}` : ""}`,
        );
        films.push(...page.data);
        cursor = page.page.nextCursor;
      } while (cursor);
      const counts = new Map<string, { decade: number; name: string; count: number }>();
      for (const film of films) {
        const decade = Math.floor(film.year / 10) * 10;
        for (const genre of film.genres) {
          const key = `${decade}:${genre.id}`;
          const entry = counts.get(key) ?? { decade, name: genre.name, count: 0 };
          entry.count += 1;
          counts.set(key, entry);
        }
      }
      return {
        studio: {
          name: studio.name,
          filmCount: studio.filmCount,
          genreBreakdown: [...counts.values()]
            .sort((x, y) => x.decade - y.decade || y.count - x.count || (x.name < y.name ? -1 : x.name > y.name ? 1 : 0))
            .map((entry) => ({ decade: entry.decade, genre: { name: entry.name }, count: entry.count })),
        },
      };
    },
  },
  {
    id: "path",
    label: "Shortest link between two actors",
    summary: "The shortest co-star chain from Kevin Bacon to Marilyn Monroe, up to 3 films.",
    query: ACTOR_PATH,
    variables: { from: "3454165", to: "4616" },
    restSteps: ({ from, to }) => [
      `GET /people/${from}`,
      `GET /people/${to}`,
      `GET /paths?from=${from}&to=${to}&maxHops=3  (a purpose-built endpoint)`,
    ],
    async rest(get, { from, to }) {
      const [personFrom, personTo, path] = await Promise.all([
        get(`/people/${enc(from)}`),
        get(`/people/${enc(to)}`),
        get(`/paths?from=${enc(from)}&to=${enc(to)}&maxHops=3`),
      ]);
      return {
        from: { name: personFrom.name },
        to: { name: personTo.name },
        actorPath: path.data && {
          hops: path.data.hops,
          steps: path.data.steps.map((step: any) => ({
            from: { name: step.from.name },
            film: { title: step.film.title, year: step.film.year },
            to: { name: step.to.name },
          })),
        },
      };
    },
  },
];

/** The N+1 demo, kept separate from the preset list. */
export const SIX_DEGREES_PRESET: Preset = {
  id: "six-degrees",
  label: "Six degrees (N+1 demo)",
  summary: "Pulp Fiction's cast, then every cast member's other films.",
  query: SIX_DEGREES,
  variables: { id: "104123" },
  restSteps: ({ id }) => [
    `GET /films/${id}`,
    `GET /films/${id}/credits?role=actor`,
    "GET /people/{personId}/films?role=actor  (one per cast member)",
  ],
  async rest(get, { id }) {
    const [film, cast] = await Promise.all([get(`/films/${enc(id)}`), get(`/films/${enc(id)}/credits?role=actor`)]);
    const filmographies = await Promise.all(
      cast.data.map((credit: any) => get(`/people/${credit.person.id}/films?role=actor`)),
    );
    return {
      film: {
        title: film.title,
        year: film.year,
        cast: cast.data.map((credit: any, index: number) => ({
          person: {
            name: credit.person.name,
            filmography: filmographies[index].data.map((c: any) => ({ film: { title: c.film.title, year: c.film.year } })),
          },
        })),
      },
    };
  },
};

export const ALL_PRESETS = [...PRESETS, SIX_DEGREES_PRESET];
