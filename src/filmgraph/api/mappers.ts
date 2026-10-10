/** Internal row types that back each GraphQL type (used by GraphQL Code Generator). */
import type { CreditRow, FilmFilter, FilmRow, NamedRow, Page, PathStep, PersonRow } from "../db/access";

export type FilmModel = FilmRow;
export type PersonModel = PersonRow;
export type CreditModel = CreditRow;
export type StudioModel = NamedRow;
export type GenreModel = NamedRow & { filmCount?: number };
export type FilmConnectionModel = { page: Page<FilmRow>; filter: FilmFilter };
export type PersonConnectionModel = Page<PersonRow>;
export type StudioConnectionModel = Page<NamedRow>;
export type PathStepModel = PathStep;
export type ActorPathModel = { hops: number; steps: PathStep[] };
export type DecadeCreditsModel = { decade: number; credits: CreditRow[] };
export type GenreDecadeCountModel = { decade: number; count: number; genre: GenreModel };
