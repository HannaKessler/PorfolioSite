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

Searchable Shop is a sample catalog. Prices and stock come from the [DummyJSON product list](https://dummyjson.com/products). Nothing is for sale, and there is no checkout.

The page you just used reads `src/data/catalog.json` from this repo. That file is produced locally, then committed. A visit to this site does not start Elasticsearch.

`catalog/generate.ps1` downloads the free Elasticsearch distribution, starts it on your machine, and stops it when the file is written. The Java indexer loads every DummyJSON product into the index, including category names. The Python step adds the discounted price and a search blob of the description and reviews, then asks Elasticsearch which products are similar. Those neighbor ids are what the “Similar products” row on an item page uses.

The five rows on the shop home are popular categories until you accept the cookie notice. Accepting stores up to eight recent searches in this browser for 30 days and fills rows from the top with products similar to those searches. Rejecting is the default and leaves the popular rows in place. Searches are not sent to a server.

After a search, the rows are replaced by a result grid. The grid is filtered in the browser. The catalog is 194 products, which is small enough to ship with the site.
