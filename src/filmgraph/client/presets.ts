/**
 * Explorer questions. Each one is a sentence with blanks (people or studios
 * the visitor picks by name), a GraphQL document whose variables are the
 * chosen ids, and a REST plan: the sequence of REST calls a client would make
 * to build exactly the same data. The contract tests run both and check they
 * produce identical results.
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

/** What a blank searches for. Directors and actors are people filtered by role. */
export type BlankKind = "director" | "actor" | "studio";

export interface Choice {
  id: string;
  name: string;
}

export interface Blank {
  /** The GraphQL variable this blank fills. */
  variable: string;
  kind: BlankKind;
  /** Accessible name for the blank, e.g. "Director" or "Second actor". */
  label: string;
  default: Choice;
}

/** A sentence: plain text and blanks, in reading order. */
export type SentencePart = string | Blank;

export interface Preset {
  id: string;
  label: string;
  summary: string;
  sentence: SentencePart[];
  query: string;
  variables: Record<string, string>;
  /** Human-readable REST call sequence, shown before running. */
  restSteps: (variables: Record<string, string>) => string[];
  /** Runs the REST calls and assembles the same shape as GraphQL's `data`. */
  rest: (get: RestGet, variables: Record<string, string>) => Promise<unknown>;
}

const enc = encodeURIComponent;

function blank(variable: string, kind: BlankKind, label: string, id: string, name: string): Blank {
  return { variable, kind, label, default: { id, name } };
}

export const blanksOf = (preset: Preset) => preset.sentence.filter((part): part is Blank => typeof part !== "string");

/** Variables for a preset from the chosen people or studios. */
export function variablesFor(preset: Preset, choices: Record<string, Choice>): Record<string, string> {
  return Object.fromEntries(blanksOf(preset).map((b) => [b.variable, (choices[b.variable] ?? b.default).id]));
}

/** Default choices for a preset's blanks. */
export const defaultChoices = (preset: Preset): Record<string, Choice> =>
  Object.fromEntries(blanksOf(preset).map((b) => [b.variable, b.default]));

export const PRESETS: Preset[] = [
  {
    id: "director",
    label: "Every film [director] directed, with its cast",
    summary: "Each film in the list comes with its billed cast and character names.",
    sentence: ["Every film ", blank("id", "director", "Director", "25191", "Christopher Nolan"), " directed, with its cast"],
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
    label: "[Actor]’s films, by decade",
    summary: "Acting credits grouped by decade, with each film’s genres.",
    sentence: [blank("id", "actor", "Actor", "2263", "Tom Hanks"), "’s films, by decade"],
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
    label: "Films [actor] and [actor] both appear in",
    summary: "Films with both actors in the cast, their characters, and who directed them.",
    sentence: [
      "Films ",
      blank("a", "actor", "First actor", "36949", "Robert De Niro"),
      " and ",
      blank("b", "actor", "Second actor", "41163", "Al Pacino"),
      " both appear in",
    ],
    query: SHARED_FILMS,
    variables: { a: "36949", b: "41163" },
    restSteps: ({ a, b }) => [
      `GET /people/${a}`,
      `GET /people/${b}`,
      `GET /people/${a}/films?role=actor`,
      `GET /people/${b}/films?role=actor`,
      "Intersect the two lists in the client",
      "GET /films/{filmId}/credits  (one per shared film, for directors and characters)",
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
      const credits = await Promise.all(shared.map((film: any) => get(`/films/${film.id}/credits`)));
      const actingAs = (list: any[], id: string) =>
        list
          .filter((credit: any) => credit.role === "actor" && String(credit.person.id) === String(id))
          .map((credit: any) => ({ character: credit.character }));
      return {
        a: { name: personA.name },
        b: { name: personB.name },
        sharedFilms: shared.map((film: any, index: number) => ({
          title: film.title,
          year: film.year,
          directors: credits[index].data
            .filter((credit: any) => credit.role === "director")
            .map((credit: any) => ({ name: credit.person.name })),
          asA: actingAs(credits[index].data, a),
          asB: actingAs(credits[index].data, b),
        })),
      };
    },
  },
  {
    id: "studio",
    label: "What [studio] made, by genre over time",
    summary: "Films per genre in each decade. GraphQL aggregates in SQL; REST pages through every film.",
    sentence: ["What ", blank("id", "studio", "Studio", "126399", "Warner Bros. Entertainment"), " made, by genre over time"],
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
    label: "Shortest link between [actor] and [actor]",
    summary: "The shortest co-star chain between two actors, up to 3 films.",
    sentence: [
      "Shortest link between ",
      blank("from", "actor", "First actor", "3454165", "Kevin Bacon"),
      " and ",
      blank("to", "actor", "Second actor", "4616", "Marilyn Monroe"),
    ],
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
  sentence: ["Pulp Fiction’s cast, then every cast member’s other films"],
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
