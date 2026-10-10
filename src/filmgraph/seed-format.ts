/**
 * Shape of the Film Graph seed in src/data/film-graph/: a manifest plus parts,
 * each holding some of the tables. Rows are arrays to keep the files small.
 */
export const SEED_VERSION = 2;

export const ROLE_CODES = { actor: 1, director: 2, writer: 3 } as const;
export type RoleName = keyof typeof ROLE_CODES;
export const ROLE_NAMES: Record<number, RoleName> = { 1: "actor", 2: "director", 3: "writer" };

export interface Seed {
  version: number;
  generatedAt: string;
  source: string;
  /** [id, title, year, runtimeMinutes, country, description, sitelinks] */
  films: [number, string, number, number | null, string | null, string | null, number][];
  /** [id, name, birthYear] */
  people: [number, string, number | null][];
  /** [filmId, personId, roleCode, character, billingOrder] */
  credits: [number, number, number, string | null, number | null][];
  /** [id, name] */
  studios: [number, string][];
  /** [filmId, studioId] */
  filmStudios: [number, number][];
  /** [id, name] */
  genres: [number, string][];
  /** [filmId, genreId] */
  filmGenres: [number, number][];
}

/** One downloadable piece of the seed. Parts are loaded in manifest order. */
export type SeedPart = Partial<Pick<Seed, "films" | "people" | "credits" | "studios" | "filmStudios" | "genres" | "filmGenres">>;

export interface SeedManifest {
  version: number;
  generatedAt: string;
  source: string;
  /** How films were chosen: sitelink threshold, films over it, and the cap. */
  selection: { minSitelinks: number; candidates: number; maxFilms: number };
  counts: { films: number; people: number; credits: number; studios: number; genres: number };
  parts: { file: string; tables: string[]; bytes: number; gzipBytes: number }[];
}
