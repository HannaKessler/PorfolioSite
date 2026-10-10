import raw from "../data/catalog.json";

export interface Review {
  rating: number;
  comment: string;
  date: string;
  reviewerName: string;
  reviewerEmail: string;
}

export interface Product {
  id: number;
  title: string;
  description: string;
  category: string;
  categoryName: string;
  price: number;
  discountPercentage: number;
  salePrice: number;
  rating: number;
  stock: number;
  tags: string[];
  brand: string;
  sku: string;
  weight: number;
  dimensions: { width: number; height: number; depth: number };
  warrantyInformation: string;
  shippingInformation: string;
  availabilityStatus: string;
  reviews: Review[];
  returnPolicy: string;
  minimumOrderQuantity: number;
  meta: {
    createdAt: string;
    updatedAt: string;
    barcode: string;
  };
  images: string[];
  thumbnail: string;
  similarIds: number[];
}

export interface Theme {
  slug: string;
  name: string;
  averageRating: number;
}

export interface CatalogFile {
  generatedAt: string;
  source: string;
  elasticsearchVersion: string;
  popularThemes: Theme[];
  products: Product[];
}

export const catalog = raw as CatalogFile;

const byId = new Map(catalog.products.map((product) => [product.id, product]));

export function productById(id: number) {
  return byId.get(id);
}

export function similarProducts(product: Product) {
  return product.similarIds
    .map((id) => byId.get(id))
    .filter((item): item is Product => item !== undefined);
}

export function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

export function formatRating(value: number) {
  return value.toFixed(1);
}

export function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function onSale(product: Product) {
  return product.salePrice < product.price - 0.001;
}

export function stockClass(status: string) {
  const label = status.toLowerCase();
  if (label.includes("out")) return "is-out";
  if (label.includes("low")) return "is-low";
  return "is-in";
}

export interface ShopRow {
  title: string;
  items: Product[];
  query?: string;
}

const CONSENT_KEY = "open-stock.consent";
const QUERIES_KEY = "open-stock.queries";
const MAX_QUERIES = 8;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type Consent = "granted" | "denied";

interface StoredQuery {
  q: string;
  at: number;
}

export function readConsent(): Consent | null {
  try {
    const value = localStorage.getItem(CONSENT_KEY);
    return value === "granted" || value === "denied" ? value : null;
  } catch {
    return null;
  }
}

export function writeConsent(value: Consent) {
  localStorage.setItem(CONSENT_KEY, value);
  if (value === "denied") localStorage.removeItem(QUERIES_KEY);
}

export function readQueries(): string[] {
  if (readConsent() !== "granted") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(QUERIES_KEY) || "[]") as StoredQuery[];
    const cutoff = Date.now() - MAX_AGE_MS;
    const fresh = parsed.filter((entry) => entry && entry.q && entry.at >= cutoff).slice(0, MAX_QUERIES);
    localStorage.setItem(QUERIES_KEY, JSON.stringify(fresh));
    return fresh.map((entry) => entry.q);
  } catch {
    return [];
  }
}

export function rememberQuery(query: string) {
  if (readConsent() !== "granted") return;
  const cleaned = query.trim();
  if (!cleaned) return;
  const stamped: StoredQuery[] = [
    { q: cleaned, at: Date.now() },
    ...storedQueries().filter((entry) => entry.q.toLowerCase() !== cleaned.toLowerCase()),
  ].slice(0, MAX_QUERIES);
  localStorage.setItem(QUERIES_KEY, JSON.stringify(stamped));
}

function storedQueries(): StoredQuery[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(QUERIES_KEY) || "[]") as StoredQuery[];
    const cutoff = Date.now() - MAX_AGE_MS;
    return parsed.filter((entry) => entry && entry.q && entry.at >= cutoff);
  } catch {
    return [];
  }
}

export function forgetQuery(query: string) {
  const next = storedQueries().filter((entry) => entry.q !== query);
  localStorage.setItem(QUERIES_KEY, JSON.stringify(next));
}

function words(value: string) {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function distance(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 0; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
    }
  }
  return rows[a.length][b.length];
}

function fieldScore(token: string, field: string, weight: number) {
  if (!field) return 0;
  const haystack = field.toLowerCase();
  if (haystack.includes(token)) return weight * (haystack === token ? 3 : 2);
  if (token.length < 4) return 0;
  for (const word of words(field)) {
    if (word.length >= 4 && distance(token, word) <= 1) return weight;
  }
  return 0;
}

export function searchProducts(query: string) {
  const tokens = words(query);
  if (!tokens.length) return [];
  const ranked = catalog.products
    .map((product) => {
      const reviews = (product.reviews || []).map((review) => review.comment).join(" ");
      let score = 0;
      for (const token of tokens) {
        const hit =
          fieldScore(token, product.title, 10) +
          fieldScore(token, product.brand, 6) +
          fieldScore(token, product.categoryName, 5) +
          fieldScore(token, (product.tags || []).join(" "), 5) +
          fieldScore(token, product.sku, 4) +
          fieldScore(token, product.meta?.barcode || "", 4) +
          fieldScore(token, product.description, 2) +
          fieldScore(token, reviews, 1);
        if (!hit) return { product, score: 0 };
        score += hit;
      }
      return { product, score };
    })
    .filter((entry) => entry.score > 0);
  ranked.sort((a, b) => b.score - a.score || b.product.rating - a.product.rating || a.product.id - b.product.id);
  return ranked.map((entry) => entry.product);
}

export function suggestions(query: string) {
  return searchProducts(query).slice(0, 6);
}

export function similarToQuery(query: string) {
  const hits = searchProducts(query);
  if (!hits.length) return [];
  const hidden = new Set(hits.slice(0, 8).map((product) => product.id));
  const chosen: Product[] = [];
  const seen = new Set(hidden);
  for (const hit of hits.slice(0, 4)) {
    for (const id of hit.similarIds || []) {
      if (seen.has(id)) continue;
      const product = byId.get(id);
      if (!product) continue;
      seen.add(id);
      chosen.push(product);
      if (chosen.length === 12) return chosen;
    }
  }
  const category = hits[0].category;
  for (const product of catalog.products) {
    if (product.category !== category || seen.has(product.id)) continue;
    seen.add(product.id);
    chosen.push(product);
    if (chosen.length === 12) break;
  }
  return chosen;
}

export function popularRows(): ShopRow[] {
  return catalog.popularThemes.map((theme) => ({
    title: `Popular in ${theme.name}`,
    items: catalog.products
      .filter((product) => product.category === theme.slug)
      .sort((a, b) => b.rating - a.rating || a.id - b.id)
      .slice(0, 12),
  }));
}

export function browseRows(): ShopRow[] {
  const rows: ShopRow[] = [];
  for (const query of readQueries()) {
    if (rows.length === 5) break;
    const items = similarToQuery(query);
    if (!items.length) continue;
    rows.push({ title: `Similar to “${query}”`, items, query });
  }
  for (const row of popularRows()) {
    if (rows.length === 5) break;
    rows.push(row);
  }
  return rows.slice(0, 5);
}

export function productHref(id: number, query: string) {
  const base = `/projects/catalog/${id}`;
  return query ? `${base}?q=${encodeURIComponent(query)}` : base;
}
