---
title: Film Graph
description: GraphQL and REST side by side over a film database that runs entirely in your browser.
pubDate: 2026-10-10
featured: true
listed: true
tags:
  - TypeScript
  - GraphQL
  - REST
  - Postgres
  - React
githubUrl: https://github.com/HannaKessler/PorfolioSite
demoUrl: /projects/film-graph
---

## Overview

Film Graph is a GraphQL and REST explorer built into the Astro portfolio site at `/projects/film-graph`. It covers 2,000 well-known films, 10,661 people, 25,667 credits, 776 studios and 24 genres, all taken from [Wikidata](https://www.wikidata.org/), whose data is released under CC0. The same questions can be asked through a GraphQL API and through a REST API, and the page compares the two: how many requests each one makes, how many bytes it moves, how many SQL queries it runs, how long it takes and how much of the response goes unused. The site is still fully static. The "server" is real Postgres, GraphQL Yoga and a REST router running inside the visitor's browser, so the demo costs nothing to host and each visitor gets a private copy of the database.

## Data pipeline

The data is built ahead of time by `filmgraph/build-seed.ts`, a Node and TypeScript script run with `npm run filmgraph:data`. The output is committed to the repo, the same way the shop's catalog is. The script queries the public Wikidata SPARQL endpoint with a descriptive User-Agent. It waits 300 ms between requests, gives each request a timeout, and retries rate limits and server errors with exponential backoff, honoring `Retry-After`. Responses are cached in a git-ignored folder, so a rerun doesn't hit the service again. It starts from every film with at least 30 Wikipedia sitelinks, keeps the 2,600 most linked as candidates, and fetches their details in batches of 120 films: English title and description, year, runtime in minutes, country, cast with the series ordinal (P1545), directors, screenwriters, production companies and genres. People are fetched in batches of 400 for names, birth years and sitelinks.

Wikidata has gaps, so the script cleans as it goes. Films without a director or with fewer than three actors are dropped. Cast is capped at 10 per film, ordered by the cast ordinal where Wikidata has one and otherwise by the actor's own notability. Genres are limited to the 24 most common "... film" genres with at least 12 films, with near-duplicate names merged. The 2,000 most notable films that survive, released between 1915 and 2026, are written to `src/data/film-graph-seed.json` as column arrays rather than objects, so no key is repeated 25,000 times. The file is 1.4 MB, or 476 KB gzipped, well under the 2 MB budget that CI enforces. Wikidata IDs double as primary keys, so every record links back to its source.

## Browser backend

The database is [PGlite](https://pglite.dev/), Postgres compiled to WebAssembly. The schema has `film`, `person`, `credit` (film, person, an `actor`/`director`/`writer` enum, character and billing order), `studio`, `film_studio`, `genre` and `film_genre`, with indexes on every foreign key, on year, on popularity, and GIN full-text indexes on film titles and person and studio names. On the first visit a dedicated module worker starts Postgres, downloads the seed and loads it with one set-based `INSERT ... SELECT` per table, passing each table's rows as a single JSON parameter. That took 3.5 to 3.8 seconds in headless Chromium on my test machine. Shortly after it's ready, the worker saves a gzipped copy of the whole data directory to IndexedDB. Later visits start Postgres straight from that copy, which took about 0.7 seconds, with no seed download. The seed URL carries a content hash, so a new seed replaces the saved copy automatically. A Reset button deletes it.

A service worker makes this look like a normal backend. It is registered with a scope of `/projects/film-graph/`, so it can't touch any other page, and it only answers requests under `/projects/film-graph/api/`. Postgres doesn't live inside the service worker, because browsers stop idle service workers whenever they like, which would throw the in-memory database away mid-session. Instead the service worker turns each request into a plain message and passes it over a `MessageChannel` to the page, which relays it to the database worker and returns the reply. The page's `fetch` calls get real `Request` and `Response` objects with real status codes and headers, and every call shows up in the browser's Network tab. If service workers aren't available, for example in a private window that blocks them, the explorer talks to the worker directly with the same objects and says so in the status banner.

PGlite, Yoga, the editor and the seed only load on this page. The rest of the site downloads none of it, and an end-to-end test checks that. The cost is a large first download for the demo itself: about 6.4 MB compressed, most of it the Postgres WebAssembly binary and its data files.

## GraphQL and REST

Both APIs sit on one TypeScript data-access layer (`src/filmgraph/db/access.ts`), so they run the same SQL and return the same data. That keeps the comparison fair. The GraphQL schema has `Film`, `Person`, `Credit`, `Studio` and `Genre` types and queries for single records, cursor-paginated film lists with title search, genre, studio and year-range filters, name search for people and studios, `sharedFilms` for two people and `actorPath` for the shortest co-star chain between two actors. Cursors are opaque, base64-encoded sort keys. Errors carry a stable `extensions.code` of `BAD_USER_INPUT` or `NOT_FOUND`, and resolver types are generated from the schema with GraphQL Code Generator.

The REST API has 13 routes: `/films`, `/films/:id`, `/films/:id/credits`, `/people`, `/people/:id`, `/people/:id/films`, the same three for studios and genres, and `/paths`. Lists take the same filters plus `limit` and `cursor`, and return a `page` object with the next cursor. Resources link to related resources rather than embedding them, the way a typical REST API would, and errors come back as 400 or 404 JSON bodies with the same codes.

`actorPath` runs a bidirectional breadth-first search limited to three films. Each step is a single SQL query that expands the smaller side, so the worst case is three queries. In each preset, the REST side runs the calls a client would really need, one after another where each depends on the last, and puts the pieces together into the same shape the GraphQL query returns.

## Performance

**Batching.** Every GraphQL request gets fresh DataLoaders for films, people, studios, genres and credits, so lookups made in the same tick become one `WHERE id = ANY($1)` query. The N+1 panel asks for Pulp Fiction's cast and every cast member's films, first with batching turned off through a request header and then on. In my runs, batching off took 156 SQL queries and 85 ms, and batching on took 5 queries and 21 ms.

**Persisted queries.** The preset queries ship with the backend as an allowlist, keyed by their SHA-256 hashes, through Yoga's persisted operations plugin. With the toggle on, the page sends only the hash and the variables. For the director preset, that cut the request body from 372 bytes to 154 bytes, saving 218 bytes (59%). A second toggle switches the server to allowlist mode, where any query that isn't registered is rejected. The panel has a button to try one.

**ETags.** Every REST response has an ETag made from a SHA-256 hash of its body. The page keeps the bodies it has seen and sends `If-None-Match`, and unchanged resources come back as 304 with no body. Running the director preset again revalidated all 15 REST calls and cut the bytes received from 22 KB to nothing. The server still runs the queries to compute the hash, so ETags save bandwidth here, not database time.

**The comparison.** For "every film Christopher Nolan directed, with each film's billed cast," GraphQL took 1 request, 10 KB, 5 SQL queries and 24 to 31 ms. REST took 15 requests, 22 KB, 43 SQL queries and 55 to 66 ms, and 53% of the bytes it received went unused. For a studio's output by genre, REST pulled 153 KB to use 8 KB. REST isn't always slower. For the shortest-path preset, REST finished first (17 ms against 35 ms) because the path endpoint already does the heavy work. The request log lists every call in order with a timeline bar, its status, whether it was an ETag hit, its size, and the SQL statements it ran with their timings.

## Testing and CI

Vitest runs 26 unit tests against PGlite in Node, covering the data layer (seed loading, filters, cursors, search, shared films, paths), the GraphQL resolvers (errors, pagination, batching counts, persisted queries) and the REST router (status codes, ETags and 304s, paging, tracing headers). Six contract tests run every preset through both GraphQL and its REST plan and require identical data. Seven Playwright tests load the built site in Chromium. They check that the service worker answers, that every preset matches across both APIs, ETag revalidation, the N+1 counts, persisted queries and the allowlist, that other pages never load Postgres, and that nothing overflows sideways from 375 to 1920 pixels. A GitHub Actions workflow checks that the generated types are up to date, then runs the typecheck, unit tests, contract tests, the seed-size budget, the site build and the end-to-end tests.

## Trade-offs and moving to a real backend

Running everything in the browser keeps the demo free and private, but it measures something a little different from production. There's no real network, so the timings show query and serialization costs, not latency, and REST's extra round trips would cost far more over a real connection. Byte counts are uncompressed JSON. Each visitor pays for a 6.4 MB first download that a hosted API wouldn't need.

The code is already split the way a server would be. `createBackend` takes a Postgres connection and returns a handler that turns a `Request` into a `Response`, so on Node it could run behind Yoga's Node adapter on AWS Lambda or a container, with PGlite swapped for `pg` and RDS. Persisted queries would let a CDN like CloudFront cache GraphQL GET requests by hash, REST ETags would carry through it unchanged, and DataLoader would stay per request. The tracing headers (`X-Request-Id`, `X-DB-Queries`, `Server-Timing`) would feed logging and monitoring instead of the request log panel.

## Stack

TypeScript, React, Astro, PGlite (Postgres in WebAssembly), GraphQL Yoga, DataLoader, CodeMirror 6 with cm6-graphql, a service worker and a web worker, GraphQL Code Generator, Vitest, Playwright, GitHub Actions, and Wikidata (CC0) via SPARQL.
