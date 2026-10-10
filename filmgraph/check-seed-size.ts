/**
 * CI budget check for the Film Graph seed: it ships to every visitor of the
 * demo, so keep it small. Fails if the gzipped seed is over 2 MB or the seed
 * is malformed.
 */
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { SEED_VERSION, type Seed } from "../src/filmgraph/seed-format.ts";

const BUDGET_GZIP_BYTES = 2 * 1024 * 1024;
const file = new URL("../src/data/film-graph-seed.json", import.meta.url);
const raw = readFileSync(file);
const gzipped = gzipSync(raw, { level: 9 }).length;
const seed = JSON.parse(raw.toString("utf8")) as Seed;

const problems: string[] = [];
if (seed.version !== SEED_VERSION) problems.push(`seed version ${seed.version}, expected ${SEED_VERSION}`);
if (seed.films.length < 1500) problems.push(`only ${seed.films.length} films`);
if (gzipped > BUDGET_GZIP_BYTES) problems.push(`gzipped size ${gzipped} bytes is over the ${BUDGET_GZIP_BYTES} byte budget`);

const kb = (bytes: number) => `${(bytes / 1024).toFixed(0)} KB`;
console.log(
  `Film Graph seed: ${seed.films.length} films, ${seed.people.length} people, ${seed.credits.length} credits; ` +
    `${kb(raw.length)} raw, ${kb(gzipped)} gzip (budget ${kb(BUDGET_GZIP_BYTES)}).`,
);
if (problems.length) {
  console.error(`Seed check failed:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
