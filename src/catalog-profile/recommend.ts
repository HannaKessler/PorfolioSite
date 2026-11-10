import { catalog, popularRows, type Product } from "../scripts/catalog-data";
import type { ProfileTraits } from "./types";

function displayPrice(product: Product) {
  return product.salePrice < product.price ? product.salePrice : product.price;
}

export function defaultRecommendedIds(limit = 12) {
  const featured = popularRows()[0]?.items ?? catalog.products.slice(0, limit);
  return featured.slice(0, limit).map((product) => String(product.id));
}

export function defaultRecommendedTitle() {
  return popularRows()[0]?.title ?? "Popular Picks";
}

export function scoreProduct(product: Product, traits: ProfileTraits) {
  const affinity = traits.preferredCategories.find((item) => item.slug === product.category);
  const categoryScore = affinity ? affinity.views * 3 + affinity.searches * 2 + affinity.carts * 4 : 0;
  let priceScore = 0;
  if (traits.priceMin !== null && traits.priceMax !== null) {
    const price = displayPrice(product);
    const mid = (traits.priceMin + traits.priceMax) / 2;
    const span = Math.max(traits.priceMax - traits.priceMin, 1);
    priceScore = Math.max(0, 2 - Math.abs(price - mid) / span);
  }
  return categoryScore + priceScore;
}

export function recommendIds(traits: ProfileTraits, viewedIds: number[], limit = 12) {
  if (!traits.preferredCategories.length && !traits.recentSearches.length) {
    return defaultRecommendedIds(limit);
  }
  const viewed = new Set(viewedIds.slice(-8));
  const ranked = catalog.products
    .map((product, index) => ({ product, index, score: scoreProduct(product, traits) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const picked: Product[] = [];
  for (const entry of ranked) {
    if (viewed.has(entry.product.id) && ranked.length > limit) continue;
    picked.push(entry.product);
    if (picked.length === limit) break;
  }
  if (picked.length < limit) {
    for (const entry of ranked) {
      if (picked.some((item) => item.id === entry.product.id)) continue;
      picked.push(entry.product);
      if (picked.length === limit) break;
    }
  }
  return picked.map((product) => String(product.id));
}

/** Secondary sort only: keeps the original relative order when scores tie. */
export function rerankProducts<T extends { id: number; category: string; salePrice: number; price: number }>(
  products: T[],
  traits: ProfileTraits,
) {
  return products
    .map((product, index) => ({ product, index, score: scoreProduct(product as unknown as Product, traits) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.product);
}

export function recommendationReason(traits: ProfileTraits) {
  const top = traits.preferredCategories[0];
  if (top) return `Based on interest in ${top.name}`;
  if (traits.recentSearches[0]) return `Based on your search for “${traits.recentSearches[0]}”`;
  return null;
}
