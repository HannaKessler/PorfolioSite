/** Shape of src/data/film-graph-seed.json. Rows are arrays to keep the file small. */
export const SEED_VERSION = 1;

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
