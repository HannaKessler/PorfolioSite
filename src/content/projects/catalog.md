---
title: Searchable Shop
description: Mock shopping application. Suggestions based on popularity and recent search history.
pubDate: 2026-10-09
featured: true
tags:
  - TypeScript
  - Java
  - Python
  - Elasticsearch
githubUrl: https://github.com/HannaKessler/PorfolioSite
demoUrl: /projects/catalog
---

## Overview

Searchable Shop is a mock storefront built into the Astro portfolio site at `/projects/catalog`. It uses 194 sample products from the [DummyJSON product API](https://dummyjson.com/products). Nothing is for sale, and there's no checkout. The site is fully static. Search, recommendations and filtering all run in the browser against a JSON file that ships with the site, so visitors never touch a backend or search server.

## Offline data pipeline

The catalog data is built ahead of time on a local machine by a PowerShell script, `catalog/generate.ps1`, and the output is committed to the repo. The script downloads Elasticsearch 8.18.2 and the `org.json` Java library into a folder git ignores. It starts Elasticsearch as a single local node on port 9200, with security, SSL, machine learning and GeoIP downloads turned off and a 512 MB memory limit. It checks first that nothing else is using the port, and it waits up to about three minutes for the server to be ready. It then compiles and runs the Java indexer with the JDK bundled inside Elasticsearch, so no separate Java install is needed, and runs the Python step after that. Elasticsearch is always shut down at the end, even if a step fails.

## Java indexer

The indexer, `catalog/Indexer.java`, is written with Java's built-in HTTP client and the `org.json` library. It fetches DummyJSON's category list so each product gets a readable category name. Then it pages through the product API 50 items at a time until it has the whole catalog, filling in a blank brand where one is missing. It deletes and recreates a `products` index with one shard, no replicas and an explicit mapping. Title, description, brand and search text are full-text fields. Category, category name and tags are exact-match keyword fields, and rating is a number. Products are loaded with Elasticsearch's bulk API in batches of 40, using each product's id as the document id, and the indexer stops if any batch reports an error.

## Python enrichment

The enrichment script, `catalog/enrich.py`, uses only Python's standard library. It reads every product back from the index and checks that it got at least 100. For each product it calculates a sale price from the price and discount percentage. It also builds a combined search text from the title, description, brand, category, tags and review comments, and writes both back to the index. It ranks categories by average rating, then product count, and keeps the top five for the shop's "popular" rows. For each product it then runs an Elasticsearch "more like this" query across the text fields to find up to 12 similar products, leaving out the product itself. The script stops if fewer than five categories exist or if no similar products come back. Finally it writes `src/data/catalog.json`, about 466 KB, with each product's similar-product ids attached and internal fields such as the search text and QR codes removed.

## Front end

The shop is built from Astro components and TypeScript modules. The shop page puts a header (the logo, the search form and a cookie settings button) above a content area and a consent dialog. Astro generates one static page per product at build time. Each product page shows an image gallery with clickable thumbnails, the price with any sale and discount, stock status, tags, a table of product details (SKU, weight, dimensions, warranty, shipping, returns, minimum order, barcode and dates), customer reviews, and a "Similar products" carousel. The shop's first view, five popular category rows of up to 12 products each, is also rendered at build time. The browser takes over after the page loads. All HTML built in the browser escapes its content, and only `https://` image URLs are allowed.

## Client-side search

Search runs entirely in the browser. The query is split into lowercase words, and each word is scored against weighted product fields: title 10, brand 6, category 5, tags 5, SKU 4, barcode 4, description 2 and review text 1. An exact field match counts triple and a partial match counts double. Words of four or more letters also tolerate one typo, with a quick length check that skips comparisons that can't match. Every word has to match something, and results are sorted by score, then rating. While you type, a dropdown suggests the top six matches once you've entered two characters. The results page shows a product grid with category filter chips built from the matching products. The search is kept in the URL, so the browser's back and forward buttons work. Product links carry the search along, so an item page can offer "Back to results" and its similar-product links keep your search.

## Personalization

By default, and if you reject the consent notice, the shop shows five popular category rows with the highest-rated products first. If you accept, the browser keeps your eight most recent searches for 30 days in its local storage, without duplicates and with the newest first, and expired searches are cleared out. Those searches replace popular rows from the top with "Similar to" rows for your searches, up to five rows in total. Each one combines the similar products of the top four results for that search, skipping the top eight results themselves, and fills in from the top result's category if it needs more items. Each personalized row has a Remove button. Rejecting deletes any saved searches, and searches are never sent to a server. The consent dialog is an accessible modal that moves focus to its buttons. It appears until you make a choice, can be reopened from Cookie settings, and closes with Escape or a click outside once a choice exists.

## Carousels

Product rows are horizontal scrolling tracks with previous and next buttons that move about 80% of the visible width at a time, never less than 220 pixels. The buttons turn off at either end of a row and update as you scroll, resize the window or images load. Keyboard users can tab to each track.

## Stack

Astro, TypeScript, Java 17 or newer, Python 3, Elasticsearch 8.18.2, PowerShell, and the DummyJSON product API.
