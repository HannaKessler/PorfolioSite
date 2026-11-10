import { catalog, searchProducts, type Product } from "../scripts/catalog-data";
import type { CategoryAffinity, ProfileEvent, ProfileTraits, Segment } from "./types";

function displayPrice(product: Product) {
  return product.salePrice < product.price ? product.salePrice : product.price;
}

function categoryName(slug: string) {
  return catalog.products.find((product) => product.category === slug)?.categoryName ?? slug;
}

/** Derive traits from the existing search list plus view and cart events. Searches are not stored twice. */
export function deriveTraits(searches: string[], events: ProfileEvent[]): ProfileTraits {
  const affinities = new Map<string, CategoryAffinity>();
  const prices: number[] = [];

  const bump = (slug: string, field: "views" | "searches" | "carts") => {
    if (!slug) return;
    const current = affinities.get(slug) ?? { name: categoryName(slug), slug, views: 0, searches: 0, carts: 0 };
    current[field] += 1;
    affinities.set(slug, current);
  };

  for (const query of searches) {
    for (const product of searchProducts(query).slice(0, 4)) {
      bump(product.category, "searches");
    }
  }

  for (const event of events) {
    const product = catalog.products.find((item) => item.id === event.productId);
    if (!product) continue;
    if (event.type === "PRODUCT_VIEW") bump(product.category, "views");
    if (event.type === "ADD_TO_CART") bump(product.category, "carts");
    prices.push(displayPrice(product));
  }

  const preferredCategories = [...affinities.values()].sort(
    (a, b) => b.views + b.searches + b.carts * 2 - (a.views + a.searches + a.carts * 2) || a.slug.localeCompare(b.slug),
  );

  return {
    preferredCategories,
    priceMin: prices.length ? Math.min(...prices) : null,
    priceMax: prices.length ? Math.max(...prices) : null,
    recentSearches: [...searches],
  };
}

export function deriveSegments(traits: ProfileTraits): Segment[] {
  const segments: Segment[] = [];
  const top = traits.preferredCategories[0];
  const topWeight = top ? top.views + top.searches + top.carts : 0;
  if (top && topWeight >= 2) {
    segments.push({ id: "category_focus", label: `Interested in ${top.name}` });
  }
  if (traits.priceMin !== null && traits.priceMax !== null) {
    segments.push({ id: "value_band", label: "Has a preferred price range" });
  }
  return segments;
}

export function eventCount(searches: string[], events: ProfileEvent[]) {
  return searches.length + events.length;
}

export function hasUsableProfile(traits: ProfileTraits) {
  return traits.preferredCategories.length > 0 || traits.recentSearches.length > 0;
}
