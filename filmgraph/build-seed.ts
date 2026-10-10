/**
 * Film Graph offline data pipeline.
 *
 * Pulls a curated set of notable films from the Wikidata SPARQL endpoint
 * (data is CC0), cleans it and writes src/data/film-graph-seed.json, a compact
 * column-array seed that the browser loads into PGlite.
 *
 * Run: npm run filmgraph:data   (raw responses are cached in filmgraph/.cache)
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { ROLE_CODES, SEED_VERSION, type Seed } from "../src/filmgraph/seed-format.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const cacheDir = join(here, ".cache");
const outFile = join(root, "src", "data", "film-graph-seed.json");

const ENDPOINT = "https://query.wikidata.org/sparql";
const USER_AGENT =
  "FilmGraphSeedBuilder/1.0 (https://github.com/HannaKessler/PorfolioSite; portfolio demo, run by hand)";

const TARGET_FILMS = 2000;
const MIN_SITELINKS = 30;
// Fetch details for a margin above the target so films dropped for thin credits can be replaced.
const MAX_CANDIDATES = 2600;
const MAX_CAST = 10;
const MIN_ACTORS = 3;
const FILM_BATCH = 120;
const PERSON_BATCH = 400;
const MAX_GENRES = 24;
const MIN_GENRE_FILMS = 12;

type Binding = Record<string, { type: string; value: string; "xml:lang"?: string }>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs one SPARQL query with caching, a polite delay and retries with backoff. */
async function sparql(query: string, label: string): Promise<Binding[]> {
  const key = createHash("sha1").update(query).digest("hex").slice(0, 16);
  const cacheFile = join(cacheDir, `${key}.json`);
  if (existsSync(cacheFile)) return JSON.parse(readFileSync(cacheFile, "utf8"));

  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/sparql-results+json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ query }).toString(),
        signal: AbortSignal.timeout(90_000),
      });
      if (response.status === 429 || response.status >= 500) {
        const retryAfter = Number(response.headers.get("retry-after")) || 0;
        const wait = Math.max(retryAfter * 1000, 2000 * 2 ** attempt);
        console.warn(`  ${label}: HTTP ${response.status}, retrying in ${Math.round(wait / 1000)}s`);
        await sleep(wait);
        continue;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
      const json = (await response.json()) as { results: { bindings: Binding[] } };
      const rows = json.results.bindings;
      writeFileSync(cacheFile, JSON.stringify(rows));
      await sleep(300);
      return rows;
    } catch (error) {
      if (attempt === 6) throw error;
      const wait = 2000 * 2 ** attempt;
      console.warn(`  ${label}: ${(error as Error).message}, retrying in ${wait / 1000}s`);
      await sleep(wait);
    }
  }
  throw new Error(`${label}: gave up`);
}

const qid = (uri: string) => uri.slice(uri.lastIndexOf("/") + 1);
const num = (uri: string) => Number(qid(uri).slice(1));
const values = (ids: number[]) => ids.map((id) => `wd:Q${id}`).join(" ");
const yearOf = (value?: string) => {
  if (!value) return null;
  const match = /^(-?\d{1,4})-/.exec(value);
  return match ? Number(match[1]) : null;
};

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function clean(text: string | undefined, max = 200): string | null {
  if (!text) return null;
  const value = text.replace(/\s+/g, " ").trim();
  if (!value) return null;
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}

/** Wikidata labels that are just the QID mean "no English label". */
const hasLabel = (label: string | undefined) => !!label && !/^Q\d+$/.test(label);

async function main() {
  mkdirSync(cacheDir, { recursive: true });

  console.log("1/6 Candidate films by sitelinks");
  const candidates = (
    await sparql(
      `SELECT ?film ?sl WHERE { ?film wdt:P31 wd:Q11424 ; wikibase:sitelinks ?sl . FILTER(?sl >= ${MIN_SITELINKS}) }`,
      "candidates",
    )
  )
    .map((row) => ({ id: num(row.film.value), sitelinks: Number(row.sl.value) }))
    .sort((a, b) => b.sitelinks - a.sitelinks || a.id - b.id);
  const candidateIds = [...new Set(candidates.map((c) => c.id))].slice(0, MAX_CANDIDATES);
  const sitelinks = new Map(candidates.map((c) => [c.id, c.sitelinks]));
  console.log(`  ${candidateIds.length} candidates`);

  type FilmRow = {
    id: number;
    title: string;
    year: number | null;
    runtime: number | null;
    description: string | null;
    country: string | null;
  };
  const films = new Map<number, FilmRow>();
  const cast = new Map<number, { person: number; ordinal: number | null; character: string | null }[]>();
  const crew: { film: number; person: number; role: "director" | "writer" }[] = [];
  const filmStudios: [number, number][] = [];
  const studioNames = new Map<number, string>();
  const filmGenreRaw: [number, number][] = [];
  const genreLabels = new Map<number, string>();

  console.log("2/6 Film details, cast, crew, studios and genres");
  const batches = chunks(candidateIds, FILM_BATCH);
  for (const [index, batch] of batches.entries()) {
    const ids = values(batch);
    const tag = `batch ${index + 1}/${batches.length}`;
    process.stdout.write(`  ${tag}\r`);

    const core = await sparql(
      `SELECT ?film (SAMPLE(?t) AS ?title) (SAMPLE(?d) AS ?desc) (MIN(?date) AS ?released) (MAX(?dur) AS ?minutes) (SAMPLE(?cl) AS ?country) WHERE {
        VALUES ?film { ${ids} }
        ?film rdfs:label ?t . FILTER(LANG(?t) = "en")
        OPTIONAL { ?film schema:description ?d . FILTER(LANG(?d) = "en") }
        OPTIONAL { ?film wdt:P577 ?date }
        OPTIONAL { ?film p:P2047/psv:P2047 [ wikibase:quantityAmount ?dur ; wikibase:quantityUnit wd:Q7727 ] }
        OPTIONAL { ?film wdt:P495 ?c . ?c rdfs:label ?cl . FILTER(LANG(?cl) = "en") }
      } GROUP BY ?film`,
      `${tag} core`,
    );
    for (const row of core) {
      const runtime = row.minutes ? Math.round(Number(row.minutes.value)) : null;
      films.set(num(row.film.value), {
        id: num(row.film.value),
        title: row.title.value.trim(),
        year: yearOf(row.released?.value),
        runtime: runtime && runtime > 0 && runtime < 1000 ? runtime : null,
        description: clean(row.desc?.value, 160),
        country: clean(row.country?.value, 60),
      });
    }

    const castRows = await sparql(
      `SELECT ?film ?person ?ord ?charName ?roleLabel WHERE {
        VALUES ?film { ${ids} }
        ?film p:P161 ?st . ?st ps:P161 ?person .
        OPTIONAL { ?st pq:P1545 ?ord }
        OPTIONAL { ?st pq:P4633 ?charName }
        OPTIONAL { ?st pq:P453 ?role . ?role rdfs:label ?roleLabel . FILTER(LANG(?roleLabel) = "en") }
      }`,
      `${tag} cast`,
    );
    for (const row of castRows) {
      const film = num(row.film.value);
      if (!row.person.value.includes("/entity/Q")) continue;
      const list = cast.get(film) ?? [];
      const person = num(row.person.value);
      const ordinal = row.ord && /^\d+$/.test(row.ord.value) ? Number(row.ord.value) : null;
      const character = clean(row.charName?.value ?? row.roleLabel?.value, 80);
      const existing = list.find((entry) => entry.person === person);
      if (existing) {
        existing.ordinal ??= ordinal;
        existing.character ??= character;
      } else {
        list.push({ person, ordinal, character });
      }
      cast.set(film, list);
    }

    const crewRows = await sparql(
      `SELECT ?film ?person ?prop WHERE {
        VALUES ?film { ${ids} }
        VALUES ?prop { wdt:P57 wdt:P58 }
        ?film ?prop ?person .
      }`,
      `${tag} crew`,
    );
    for (const row of crewRows) {
      if (!row.person.value.includes("/entity/Q")) continue;
      crew.push({
        film: num(row.film.value),
        person: num(row.person.value),
        role: row.prop.value.endsWith("P57") ? "director" : "writer",
      });
    }

    const tagRows: Binding[] = [];
    for (const [kind, prop] of [["studio", "P272"], ["genre", "P136"]] as const) {
      const rows = await sparql(
        `SELECT ?film ?item ?label WHERE {
          VALUES ?film { ${ids} }
          ?film wdt:${prop} ?item .
          OPTIONAL { ?item rdfs:label ?label . FILTER(LANG(?label) = "en") }
        }`,
        `${tag} ${kind}s`,
      );
      for (const row of rows) if (row.label) tagRows.push({ ...row, kind: { type: "literal", value: kind } });
    }
    for (const row of tagRows) {
      const film = num(row.film.value);
      const item = num(row.item.value);
      if (row.kind.value === "studio") {
        filmStudios.push([film, item]);
        studioNames.set(item, clean(row.label.value, 80)!);
      } else {
        filmGenreRaw.push([film, item]);
        genreLabels.set(item, row.label.value);
      }
    }
  }
  console.log("");

  console.log("3/6 Choosing films");
  const castIds = new Set<number>();
  for (const list of cast.values()) for (const entry of list) castIds.add(entry.person);
  const crewIds = new Set(crew.map((c) => c.person));
  const allPeople = [...new Set([...castIds, ...crewIds])];

  console.log(`4/6 People (${allPeople.length})`);
  type PersonRow = { id: number; name: string; birthYear: number | null; sitelinks: number };
  const people = new Map<number, PersonRow>();
  const personBatches = chunks(allPeople, PERSON_BATCH);
  for (const [index, batch] of personBatches.entries()) {
    process.stdout.write(`  batch ${index + 1}/${personBatches.length}\r`);
    const rows = await sparql(
      `SELECT ?p (SAMPLE(?n) AS ?name) (MIN(?b) AS ?born) (SAMPLE(?sl) AS ?links) WHERE {
        VALUES ?p { ${values(batch)} }
        ?p rdfs:label ?n . FILTER(LANG(?n) = "en")
        OPTIONAL { ?p wdt:P569 ?b }
        OPTIONAL { ?p wikibase:sitelinks ?sl }
      } GROUP BY ?p`,
      `people ${index + 1}`,
    );
    for (const row of rows) {
      const name = row.name.value.trim();
      if (!hasLabel(name)) continue;
      people.set(num(row.p.value), {
        id: num(row.p.value),
        name,
        birthYear: yearOf(row.born?.value),
        sitelinks: Number(row.links?.value ?? 0),
      });
    }
  }
  console.log("");

  console.log("5/6 Cleaning and billing order");
  // Cast billing: Wikidata rarely records billing order, and SPARQL cannot see the
  // order statements were entered in. Use the series ordinal (P1545) when present,
  // otherwise rank by the actor's own notability (sitelinks), then id for stability.
  const credits: Seed["credits"] = [];
  const keptFilms: FilmRow[] = [];
  const crewByFilm = new Map<number, typeof crew>();
  for (const entry of crew) {
    const list = crewByFilm.get(entry.film) ?? [];
    if (!list.some((c) => c.person === entry.person && c.role === entry.role)) list.push(entry);
    crewByFilm.set(entry.film, list);
  }

  for (const id of candidateIds) {
    const film = films.get(id);
    if (!film || !hasLabel(film.title) || film.year === null) continue;
    const actors = (cast.get(id) ?? [])
      .filter((entry) => people.has(entry.person))
      .sort((a, b) => {
        if (a.ordinal !== null && b.ordinal !== null) return a.ordinal - b.ordinal;
        if (a.ordinal !== null) return -1;
        if (b.ordinal !== null) return 1;
        return people.get(b.person)!.sitelinks - people.get(a.person)!.sitelinks || a.person - b.person;
      })
      .slice(0, MAX_CAST);
    const filmCrew = (crewByFilm.get(id) ?? []).filter((entry) => people.has(entry.person));
    const directors = filmCrew.filter((entry) => entry.role === "director");
    // Drop films with too few credits: at least 3 billed actors and a director.
    if (actors.length < MIN_ACTORS || directors.length === 0) continue;
    if (keptFilms.length >= TARGET_FILMS) break;
    keptFilms.push(film);
    actors.forEach((actor, index) =>
      credits.push([id, actor.person, ROLE_CODES.actor, actor.character, index + 1]),
    );
    for (const member of filmCrew) credits.push([id, member.person, ROLE_CODES[member.role], null, null]);
  }
  const keptFilmIds = new Set(keptFilms.map((film) => film.id));

  // Genres: Wikidata has hundreds of overlapping genre items. Keep the most common
  // "... film" genres among the chosen films and give them short display names.
  const genreCounts = new Map<number, number>();
  const filmGenrePairs = new Set<string>();
  for (const [film, genre] of filmGenreRaw) {
    if (!keptFilmIds.has(film)) continue;
    const key = `${film}:${genre}`;
    if (filmGenrePairs.has(key)) continue;
    filmGenrePairs.add(key);
    genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + 1);
  }
  const genreName = (label: string) => {
    const short = label.replace(/ film$/i, "").replace(/ movie$/i, "").trim();
    return short.charAt(0).toUpperCase() + short.slice(1);
  };
  const usedNames = new Set<string>();
  const genres = [...genreCounts.entries()]
    .filter(([id, count]) => count >= MIN_GENRE_FILMS && / film$/i.test(genreLabels.get(id) ?? ""))
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .filter(([id]) => {
      const name = genreName(genreLabels.get(id)!);
      if (usedNames.has(name.toLowerCase())) return false;
      usedNames.add(name.toLowerCase());
      return true;
    })
    .slice(0, MAX_GENRES)
    .map(([id]) => [id, genreName(genreLabels.get(id)!)] as [number, string]);
  const genreIds = new Set(genres.map(([id]) => id));
  const filmGenres = [...filmGenrePairs]
    .map((pair) => pair.split(":").map(Number) as [number, number])
    .filter(([, genre]) => genreIds.has(genre))
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const studioPairs = [
    ...new Set(filmStudios.filter(([film]) => keptFilmIds.has(film)).map((pair) => pair.join(":"))),
  ]
    .map((pair) => pair.split(":").map(Number) as [number, number])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const studioIds = new Set(studioPairs.map(([, studio]) => studio));
  const studios = [...studioIds]
    .filter((id) => hasLabel(studioNames.get(id)))
    .sort((a, b) => a - b)
    .map((id) => [id, studioNames.get(id)!] as [number, string]);
  const keptStudioIds = new Set(studios.map(([id]) => id));

  const usedPeople = new Set(credits.map((credit) => credit[1]));
  const seed: Seed = {
    version: SEED_VERSION,
    generatedAt: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    source: "Wikidata (https://www.wikidata.org), CC0 1.0",
    films: keptFilms
      .sort((a, b) => a.id - b.id)
      .map((f) => [f.id, f.title, f.year!, f.runtime, f.country, f.description, sitelinks.get(f.id) ?? 0]),
    people: [...usedPeople]
      .sort((a, b) => a - b)
      .map((id) => people.get(id)!)
      .map((p) => [p.id, p.name, p.birthYear]),
    credits: credits.sort((a, b) => a[0] - b[0] || a[2] - b[2] || (a[4] ?? 99) - (b[4] ?? 99) || a[1] - b[1]),
    studios,
    filmStudios: studioPairs.filter(([, studio]) => keptStudioIds.has(studio)),
    genres: genres.sort((a, b) => a[1].localeCompare(b[1])),
    filmGenres,
  };

  console.log("6/6 Writing seed");
  const json = JSON.stringify(seed);
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, json);
  const gz = gzipSync(json, { level: 9 }).length;
  console.log(
    `  ${seed.films.length} films, ${seed.people.length} people, ${seed.credits.length} credits, ` +
      `${seed.studios.length} studios, ${seed.genres.length} genres`,
  );
  console.log(`  ${outFile}: ${(json.length / 1024).toFixed(0)} KB raw, ${(gz / 1024).toFixed(0)} KB gzip`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
