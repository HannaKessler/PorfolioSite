import {
  formatMoney,
  formatRating,
  onSale,
  popularRows,
  productHref,
  stockClass,
  type Product,
  type ShopRow,
} from "./catalog-data";

export function esc(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function httpsUrl(value: string) {
  return value.startsWith("https://") ? value : "";
}

export function cardHtml(product: Product, query: string) {
  const photo = httpsUrl(product.thumbnail || product.images?.[0] || "");
  const price = onSale(product)
    ? `<span class="os-price">${esc(formatMoney(product.salePrice))}</span><span class="os-was">${esc(formatMoney(product.price))}</span>`
    : `<span class="os-price">${esc(formatMoney(product.price))}</span>`;
  const image = photo
    ? `<img src="${esc(photo)}" alt="" loading="lazy" />`
    : `<span class="os-missing">No image</span>`;
  return `<a class="os-card" href="${esc(productHref(product.id, query))}">
    <span class="os-photo">${image}</span>
    <span class="os-card-body">
      <span class="os-brand">${esc(product.brand || product.categoryName)}</span>
      <span class="os-title">${esc(product.title)}</span>
      <span class="os-meta">${esc(product.categoryName)} · ${esc(formatRating(product.rating))} stars</span>
      <span class="os-buy">${price}<span class="os-stock ${stockClass(product.availabilityStatus)}">${esc(product.availabilityStatus)}</span></span>
    </span>
  </a>`;
}

export function carouselHtml(row: ShopRow, query: string) {
  const forget = row.query
    ? `<button type="button" class="os-forget" data-forget="${esc(row.query)}">Remove</button>`
    : "";
  const cards = row.items.map((product) => cardHtml(product, query)).join("");
  return `<section class="os-row">
    <div class="os-row-head">
      <h2>${esc(row.title)}</h2>
      ${forget}
    </div>
    <div class="os-scroller">
      <button type="button" class="os-scroll" data-scroll="-1" aria-label="Previous products">‹</button>
      <div class="os-track" tabindex="0">${cards}</div>
      <button type="button" class="os-scroll" data-scroll="1" aria-label="Next products">›</button>
    </div>
  </section>`;
}

export function browseHtml(rows: ShopRow[]) {
  return rows.map((row) => carouselHtml(row, "")).join("");
}

export function resultsHtml(query: string, products: Product[], category: string) {
  const names = new Map<string, string>();
  for (const product of products) names.set(product.category, product.categoryName);
  const categories = [...names.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const visible = category ? products.filter((product) => product.category === category) : products;
  const chips = [
    `<button type="button" class="os-chip${category ? "" : " is-on"}" data-category="">All</button>`,
    ...categories.map(
      ([slug, name]) =>
        `<button type="button" class="os-chip${slug === category ? " is-on" : ""}" data-category="${esc(slug)}">${esc(name)}</button>`,
    ),
  ].join("");
  const grid = visible.length
    ? `<div class="os-grid">${visible.map((product) => cardHtml(product, query)).join("")}</div>`
    : `<p class="os-empty">Nothing in this category matches that search.</p>`;
  const count = `${visible.length} product${visible.length === 1 ? "" : "s"}`;
  return `<div class="os-results">
    <div class="os-results-head">
      <h2>Results for “${esc(query)}”</h2>
      <p>${count}</p>
    </div>
    <div class="os-chips" role="group" aria-label="Category">${chips}</div>
    ${grid}
  </div>`;
}

export function initialBrowseHtml() {
  return browseHtml(popularRows());
}
