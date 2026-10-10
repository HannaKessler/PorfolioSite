import DataLoader from "dataloader";
import type { Db } from "../db/database";
import {
  byId,
  creditsByFilmIds,
  creditsByPersonIds,
  filmsByIds,
  genresByFilmIds,
  genresByIds,
  groupBy,
  peopleByIds,
  studiosByFilmIds,
  studiosByIds,
} from "../db/access";

/**
 * Per-request DataLoaders. With batching on, every load() in the same tick is
 * collected into one `WHERE id = ANY($1)` query and repeated keys are cached.
 * With batching off the same batch functions run once per key with no cache,
 * which is the classic N+1 pattern the explorer demonstrates.
 */
export function createLoaders(db: Db, batching: boolean) {
  const options = { batch: batching, cache: batching };
  const make = <V>(fn: (keys: readonly number[]) => Promise<V[]>) => new DataLoader<number, V>(fn, options);

  return {
    film: make(async (ids) => byId(ids, await filmsByIds(db, ids))),
    person: make(async (ids) => byId(ids, await peopleByIds(db, ids))),
    studio: make(async (ids) => byId(ids, await studiosByIds(db, ids))),
    genre: make(async (ids) => byId(ids, await genresByIds(db, ids))),
    creditsByFilm: make(async (ids) => groupBy(ids, await creditsByFilmIds(db, ids), (row) => row.filmId)),
    creditsByPerson: make(async (ids) => groupBy(ids, await creditsByPersonIds(db, ids), (row) => row.personId)),
    genresByFilm: make(async (ids) => groupBy(ids, await genresByFilmIds(db, ids), (row) => row.filmId)),
    studiosByFilm: make(async (ids) => groupBy(ids, await studiosByFilmIds(db, ids), (row) => row.filmId)),
  };
}

export type Loaders = ReturnType<typeof createLoaders>;
