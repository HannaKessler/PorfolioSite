/**
 * Name search for the question builder's blanks. The explorer asks GraphQL,
 * and the same search exists in REST; both map to the same suggestions, which
 * the contract tests check.
 */
import { PEOPLE_SEARCH, STUDIO_SEARCH } from "../operations";
import type { BlankKind } from "./presets";

export interface Suggestion {
  id: string;
  name: string;
  /** Disambiguating detail, e.g. "b. 1970 · The Dark Knight (2008)". */
  detail: string;
}

const GRAPHQL_ROLE = { director: "DIRECTOR", actor: "ACTOR" } as const;
export const SEARCH_LIMIT = 8;

interface FilmRef {
  title: string;
  year: number;
}

const filmText = (film: FilmRef | null | undefined) => (film ? `${film.title} (${film.year})` : null);
const join = (...parts: (string | null)[]) => parts.filter(Boolean).join(" · ");

function personDetail(person: { birthYear: number | null; knownFor: FilmRef | null }) {
  return join(person.birthYear ? `b. ${person.birthYear}` : null, filmText(person.knownFor));
}

function studioDetail(studio: { filmCount: number; knownFor: FilmRef | null }) {
  return join(`${studio.filmCount} ${studio.filmCount === 1 ? "film" : "films"}`, filmText(studio.knownFor));
}

export function graphqlSearch(kind: BlankKind, text: string, first = SEARCH_LIMIT) {
  return kind === "studio"
    ? { query: STUDIO_SEARCH, variables: { text, first } }
    : { query: PEOPLE_SEARCH, variables: { text, role: GRAPHQL_ROLE[kind], first } };
}

export function suggestionsFromGraphQL(kind: BlankKind, data: any): Suggestion[] {
  const edges: any[] = (kind === "studio" ? data?.studios?.edges : data?.people?.edges) ?? [];
  return edges.map(({ node }) => ({
    id: String(node.id),
    name: node.name,
    detail: kind === "studio" ? studioDetail(node) : personDetail(node),
  }));
}

export function restSearchPath(kind: BlankKind, text: string, limit = SEARCH_LIMIT) {
  const search = encodeURIComponent(text);
  return kind === "studio" ? `/studios?search=${search}&limit=${limit}` : `/people?search=${search}&role=${kind}&limit=${limit}`;
}

export function suggestionsFromRest(kind: BlankKind, body: any): Suggestion[] {
  return (body?.data ?? []).map((row: any) => ({
    id: String(row.id),
    name: row.name,
    detail: kind === "studio" ? studioDetail(row) : personDetail(row),
  }));
}

/** True when the text has something searchable (a letter or digit). */
export const searchable = (text: string) => /[\p{L}\p{N}]/u.test(text);
