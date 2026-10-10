---
title: Film Data Query
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

## What it is

Film Data Query is an explorer that answers questions about films through two APIs at once, GraphQL and REST, and compares them as they run. It covers 23,638 films, 93,510 people and 367,146 credits from [Wikidata](https://www.wikidata.org/) (CC0), with full casts, directors, writers, studios and genres. The whole backend runs in the visitor's browser. Postgres, a GraphQL server and a REST API all run on the client, so the demo is a static page with no hosting cost, and each visitor gets a private copy of the database.

Questions read as sentences with blanks, such as "Every film ___ directed, with its cast" or "Shortest link between ___ and ___." Each blank is an accessible autocomplete that searches the database by name, filtered to the role the sentence needs (directors, actors or studios). Suggestions show a birth year and best-known film to tell namesakes apart. Pressing Run sends the question to both APIs and shows the answer as readable text: a film list with casts, credits by decade, a genre-by-decade table, or a chain of co-stars. Below the answer are the generated GraphQL query (editable, with schema-aware autocomplete), the raw responses, a side-by-side comparison, a request log with the SQL behind every call, and demos of N+1 batching and persisted queries. The page downloads nothing and runs nothing until the visitor presses Run or starts typing a name.

## Architecture

The page is an Astro site with a React island. A service worker, scoped to the demo's path, intercepts requests to `/projects/film-graph/api/` and forwards each one over a `MessageChannel` to a dedicated web worker. That worker runs [PGlite](https://pglite.dev/) (Postgres compiled to WebAssembly), GraphQL Yoga and a REST router. Postgres lives in the dedicated worker rather than the service worker, because browsers stop idle service workers at will and would discard the in-memory database. The explorer's `fetch` calls receive real `Request` and `Response` objects with real status codes and headers, and every call appears in the browser's Network tab. Where service workers are unavailable, the explorer talks to the worker directly with the same objects.

On the first run the worker downloads the seed in eight parts, loads each table with one set-based `INSERT ... SELECT` over a JSON parameter, then builds the indexes and precomputed ranking tables and runs `ANALYZE`. A progress bar tracks the download and load. Once ready, the worker saves a gzipped snapshot of the database to IndexedDB, and later visits start from it. The snapshot key includes the seed's build time and the schema version, so a new seed replaces it automatically. None of this code is loaded by any other page on the site.

## Data pipeline

A Node and TypeScript script (`filmgraph/build-seed.ts`) builds the dataset ahead of time from the public Wikidata SPARQL endpoint. It selects every feature, animated or adapted film with at least 10 Wikipedia sitelinks, then fetches titles, descriptions, years, runtimes, countries, full casts with billing order, directors, writers, studios and genres in batches of 250 films, two requests at a time. It sends a descriptive User-Agent, sets timeouts, retries rate limits and server errors with exponential backoff that honors `Retry-After`, and caches every response so reruns are cheap. Labels use English where it exists and Wikidata's language-neutral label otherwise, which many recent, widely translated films rely on.

Cleaning drops films without a director or with fewer than two credited actors and merges near-duplicate genre names. Casts are ordered by Wikidata's billing ordinal where present, otherwise by each actor's own notability. The output is a manifest and eight JSON parts stored as column arrays: 16.1 MB raw and 5.03 MB gzipped. CI enforces an 8 MB budget overall and 3 MB per part. Wikidata IDs serve as primary keys, so every record traces back to its source.

## GraphQL and REST design

Both APIs sit on one TypeScript data-access layer, so they run the same SQL and return the same data, which keeps the comparison fair. The GraphQL schema exposes `Film`, `Person`, `Credit`, `Studio` and `Genre`, with cursor-paginated film lists and filters for title, genre, studio and year range, ranked name search with an optional role, `knownFor` fields for disambiguation, `sharedFilms`, and `actorPath` for the shortest co-star chain. Cursors are opaque, errors carry a stable `extensions.code` (`BAD_USER_INPUT` or `NOT_FOUND`), and resolver types are generated from the schema with GraphQL Code Generator.

The REST API has 13 resource routes (`/films`, `/films/:id/credits`, `/people?search=&role=`, `/studios/:id/films` and so on) with the same filters, `limit` and `cursor` paging, and typed 400 and 404 errors. Resources link to related resources instead of embedding them, as a conventional REST API would. For each question, the REST side makes the calls a real client would need, in dependency order, and assembles the same shape the GraphQL query returns.

Name search matches an accent-folded generated column through a GIN full-text index, so "penelope cruz" finds Penélope Cruz. Results rank exact matches first, then prefix matches, then by notability: the summed popularity of a person's films in the requested role, precomputed into a scoring table when the database is built. A search is three SQL queries: the ranked match plus two batched lookups for the known-for films. `actorPath` runs a bidirectional breadth-first search with one SQL query per step, expanding the smaller frontier, capped at three films.

## Performance

All figures were measured in headless Chromium on a desktop machine, with the full dataset loaded.

**Batching.** Each GraphQL request gets its own DataLoaders, so lookups made in the same tick collapse into one `WHERE id = ANY($1)` query. The N+1 panel fetches a film's cast and every cast member's films with batching off and then on: 1,046 SQL queries taking 384 to 480 ms, against 5 queries taking 47 to 54 ms, with identical responses.

**Persisted queries.** Every question's query and the two search queries ship with the server as an allowlist keyed by SHA-256 hash, using Yoga's persisted operations plugin. Sending the hash instead of the text cut the director question's request from 372 to 154 bytes (59% smaller). An allowlist mode rejects any query that is not registered, and the panel includes a button to try one.

**ETags.** Every REST response carries an ETag computed from its body, and the client sends `If-None-Match`. Running the director question again revalidated all 15 REST calls as 304s and cut REST bytes received from 56 KB to zero. The server still runs the queries to compute the hash, so this saves bandwidth, not database time.

**GraphQL against REST.** For every film Christopher Nolan directed with its billed cast, GraphQL used 1 request, 27 KB and 5 SQL queries (29 to 36 ms), while REST used 15 requests, 56 KB and 43 queries (51 to 93 ms), and 52% of what REST received went unused. Tom Hanks's credits by decade took GraphQL 1 request and 4 queries in 28 ms, and REST 64 requests and 190 queries in 194 ms. A studio's output by genre pulled 514 KB over REST to use 13 KB. REST is not always behind: for the shortest link between two actors, a purpose-built `/paths` endpoint keeps it at 3 requests and 35 ms, against GraphQL's 33 ms.

**Startup.** The first run downloads about 5.7 MB of engine (Postgres WebAssembly and worker code) and 5.0 MB of seed, both gzipped, and had the database ready in about 15 seconds (14.7 to 15.2 across runs). Later visits restored the IndexedDB snapshot and were ready in 2.2 seconds. Once ready, a typical question took 30 to 40 ms over GraphQL.

## Testing and CI

Vitest runs 40 unit tests against PGlite in Node, covering the data layer (filters, cursors, ranked and accent-insensitive search, shared films, paths, and regression checks on dataset completeness), the GraphQL resolvers (errors, pagination, batching counts, persisted queries) and the REST router (status codes, ETags, paging, search). Fifteen contract tests require GraphQL and REST to return identical data for every question, with both the default names and names chosen through search, and for name search itself. Twelve Playwright tests drive the built site in Chromium: no requests or downloads before interaction, the autocomplete keyboard flow, out-of-date marking instead of re-running, Ctrl+Enter, matching answers shown in full, ETag revalidation, N+1 counts, the persisted-query allowlist, isolation from the rest of the site, and no horizontal overflow from 375 to 1920 pixels with a suggestion list open. A GitHub Actions workflow checks that generated types are current, then runs the typecheck, unit and contract tests, the seed-size budget, the site build and the end-to-end suite.

## Dataset limitations

The data is a snapshot of Wikidata, taken when the seed was built, and it inherits Wikidata's coverage. Films are included when they have at least 10 Wikipedia sitelinks, which favors English-language and internationally distributed films. Smaller regional releases, short films, documentaries and television are mostly absent. Cast lists are as complete as Wikidata's, which is thorough for major releases and thin for many older or non-English films, and billing order is only exact where Wikidata records it. Character names, studios and genres vary in consistency: some films list a parent company and others a production label, and genre tagging is uneven, so per-studio and per-genre counts are indicative rather than authoritative. Birth years and runtimes are missing for some entries. The size is a deliberate limit. Covering all of Wikidata's 300,000-plus films would need a server, not a browser tab.

## Trade-offs and moving to a real backend

Running everything in the browser keeps the demo free and private, but it measures a slightly different thing from production. There is no network between client and server, so timings reflect query and serialization costs, not latency, and REST's extra round trips would cost much more over a real connection. Byte counts are uncompressed JSON. The first visit downloads about 11 MB and uses several hundred megabytes of memory for the in-browser database, a cost a hosted API would not impose.

The code is already split along server lines. `createBackend` takes a Postgres connection and returns a `Request` to `Response` handler, so on Node it would run behind Yoga's Node adapter on AWS Lambda or in a container, with PGlite replaced by `pg` and RDS. The seed pipeline would become a scheduled job that loads Postgres directly. Persisted queries would let CloudFront cache GraphQL GET requests by hash, ETags would pass through unchanged, and DataLoader would remain per request. The tracing headers (`X-Request-Id`, `X-DB-Queries`, `Server-Timing`) would feed logs and monitoring instead of the request log panel.

## Stack

TypeScript, React, Astro, PGlite (Postgres in WebAssembly), GraphQL Yoga, DataLoader, CodeMirror 6 with cm6-graphql, a service worker and a dedicated web worker, IndexedDB, GraphQL Code Generator, Vitest, Playwright, GitHub Actions, and Wikidata (CC0) through SPARQL.
