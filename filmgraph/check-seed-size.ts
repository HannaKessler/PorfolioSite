/**
 * CI budget check for the Film Graph seed: it ships to every visitor who runs
 * the demo, so keep it bounded. Fails if the gzipped parts total more than
 * 8 MB, any part is over 3 MB gzipped, or the manifest and parts disagree.
 */
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { SEED_VERSION, type SeedManifest, type SeedPart } from "../src/filmgraph/seed-format.ts";

const BUDGET_GZIP_BYTES = 8 * 1024 * 1024;
const PART_GZIP_BYTES = 3 * 1024 * 1024;
const dir = new URL("../src/data/film-graph/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", dir), "utf8")) as SeedManifest;

const problems: string[] = [];
if (manifest.version !== SEED_VERSION) problems.push(`seed version ${manifest.version}, expected ${SEED_VERSION}`);
let raw = 0;
let gzipped = 0;
const rows = { films: 0, people: 0, credits: 0 };
for (const entry of manifest.parts) {
  const bytes = readFileSync(new URL(entry.file, dir));
  const gz = gzipSync(bytes, { level: 9 }).length;
  raw += bytes.length;
  gzipped += gz;
  if (bytes.length !== entry.bytes) problems.push(`${entry.file}: ${bytes.length} bytes, manifest says ${entry.bytes}`);
  if (gz > PART_GZIP_BYTES) problems.push(`${entry.file}: ${gz} bytes gzipped is over the ${PART_GZIP_BYTES} byte part limit`);
  const part = JSON.parse(bytes.toString("utf8")) as SeedPart;
  rows.films += part.films?.length ?? 0;
  rows.people += part.people?.length ?? 0;
  rows.credits += part.credits?.length ?? 0;
}
for (const key of ["films", "people", "credits"] as const) {
  if (rows[key] !== manifest.counts[key]) problems.push(`${key}: ${rows[key]} rows, manifest says ${manifest.counts[key]}`);
}
if (rows.films < 15000) problems.push(`only ${rows.films} films`);
if (gzipped > BUDGET_GZIP_BYTES) problems.push(`gzipped total ${gzipped} bytes is over the ${BUDGET_GZIP_BYTES} byte budget`);

const mb = (bytes: number) => `${(bytes / 1048576).toFixed(2)} MB`;
console.log(
  `Film Graph seed: ${rows.films} films, ${rows.people} people, ${rows.credits} credits in ${manifest.parts.length} parts; ` +
    `${mb(raw)} raw, ${mb(gzipped)} gzip (budget ${mb(BUDGET_GZIP_BYTES)}).`,
);
if (problems.length) {
  console.error(`Seed check failed:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
