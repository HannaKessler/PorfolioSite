/**
 * Postgres schema for Film Data Query. Runs in PGlite in the browser and in Node tests.
 * Bump SCHEMA_VERSION whenever this changes, so saved browser snapshots are rebuilt.
 */
export const SCHEMA_VERSION = 3;

/**
 * Name search folds case and common accents, so "penelope cruz" finds
 * "Penélope Cruz". The API folds the typed text the same way (see foldName).
 */
export const FOLD_FROM = "áàâäãåāăąçćčďéèêëēėęěíìîïīįłñńňóòôöõøōőŕřśšşťúùûüūůűųýÿźżžğıșț";
export const FOLD_TO = "aaaaaaaaacccdeeeeeeeeiiiiiilnnnoooooooorrssstuuuuuuuuyyzzzgist";
const FOLD = (column: string) => `translate(lower(${column}), '${FOLD_FROM}', '${FOLD_TO}')`;

/** Tables and primary keys. */
export const SCHEMA_SQL = `
CREATE TYPE credit_role AS ENUM ('actor', 'director', 'writer');

CREATE TABLE film (
  id integer PRIMARY KEY,
  title text NOT NULL,
  year smallint NOT NULL,
  runtime smallint,
  country text,
  description text,
  popularity integer NOT NULL DEFAULT 0,
  wikidata_id text GENERATED ALWAYS AS ('Q' || id) STORED
);

CREATE TABLE person (
  id integer PRIMARY KEY,
  name text NOT NULL,
  birth_year smallint,
  wikidata_id text GENERATED ALWAYS AS ('Q' || id) STORED,
  search_name text GENERATED ALWAYS AS (${FOLD("name")}) STORED
);

CREATE TABLE credit (
  film_id integer NOT NULL REFERENCES film (id),
  person_id integer NOT NULL REFERENCES person (id),
  role credit_role NOT NULL,
  character text,
  billing_order smallint,
  PRIMARY KEY (film_id, person_id, role)
);

CREATE TABLE studio (
  id integer PRIMARY KEY,
  name text NOT NULL,
  wikidata_id text GENERATED ALWAYS AS ('Q' || id) STORED,
  search_name text GENERATED ALWAYS AS (${FOLD("name")}) STORED
);

CREATE TABLE film_studio (
  film_id integer NOT NULL REFERENCES film (id),
  studio_id integer NOT NULL REFERENCES studio (id),
  PRIMARY KEY (film_id, studio_id)
);

CREATE TABLE genre (
  id integer PRIMARY KEY,
  name text NOT NULL UNIQUE,
  wikidata_id text GENERATED ALWAYS AS ('Q' || id) STORED
);

CREATE TABLE film_genre (
  film_id integer NOT NULL REFERENCES film (id),
  genre_id integer NOT NULL REFERENCES genre (id),
  PRIMARY KEY (film_id, genre_id)
);

CREATE TABLE meta (key text PRIMARY KEY, value text NOT NULL);
`;

/**
 * Secondary indexes and derived tables, built once after the bulk load (much
 * faster than maintaining them row by row).
 */
export const INDEX_SQL = `
-- Notability for ranking name search: summed popularity of a person's films,
-- per role and overall (role NULL), and of a studio's films.
CREATE TABLE person_score (person_id integer NOT NULL, role credit_role, score integer NOT NULL);
INSERT INTO person_score
  SELECT c.person_id, c.role, sum(f.popularity)::int FROM credit c JOIN film f ON f.id = c.film_id GROUP BY c.person_id, c.role;
INSERT INTO person_score
  SELECT c.person_id, NULL, sum(f.popularity)::int FROM (SELECT DISTINCT person_id, film_id FROM credit) c
  JOIN film f ON f.id = c.film_id GROUP BY c.person_id;
CREATE INDEX person_score_idx ON person_score (person_id, role);
ALTER TABLE studio ADD COLUMN score integer NOT NULL DEFAULT 0;
UPDATE studio s SET score = x.score FROM (
  SELECT fs.studio_id, sum(f.popularity)::int AS score FROM film_studio fs JOIN film f ON f.id = fs.film_id GROUP BY fs.studio_id
) x WHERE x.studio_id = s.id;

-- Foreign keys that are not the leading primary key column get their own index.
CREATE INDEX credit_person_idx ON credit (person_id, role);
CREATE INDEX film_studio_studio_idx ON film_studio (studio_id);
CREATE INDEX film_genre_genre_idx ON film_genre (genre_id);
CREATE INDEX film_year_idx ON film (year);
CREATE INDEX film_popularity_idx ON film (popularity DESC, id);

-- Prefix text search on titles and names.
CREATE INDEX film_title_search_idx ON film USING gin (to_tsvector('simple', title));
CREATE INDEX person_name_search_idx ON person USING gin (to_tsvector('simple', search_name));
CREATE INDEX studio_name_search_idx ON studio USING gin (to_tsvector('simple', search_name));
`;
