/** Postgres schema for Film Graph. Runs in PGlite in the browser and in Node tests. */
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
  wikidata_id text GENERATED ALWAYS AS ('Q' || id) STORED
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
  wikidata_id text GENERATED ALWAYS AS ('Q' || id) STORED
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

-- Foreign keys that are not the leading primary key column get their own index.
CREATE INDEX credit_person_idx ON credit (person_id, role);
CREATE INDEX film_studio_studio_idx ON film_studio (studio_id);
CREATE INDEX film_genre_genre_idx ON film_genre (genre_id);
CREATE INDEX film_year_idx ON film (year);
CREATE INDEX film_popularity_idx ON film (popularity DESC, id);

-- Prefix text search on titles and names.
CREATE INDEX film_title_search_idx ON film USING gin (to_tsvector('simple', title));
CREATE INDEX person_name_search_idx ON person USING gin (to_tsvector('simple', name));
CREATE INDEX studio_name_search_idx ON studio USING gin (to_tsvector('simple', name));

CREATE TABLE meta (key text PRIMARY KEY, value text NOT NULL);
`;
