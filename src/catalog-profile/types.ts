export type ConsentState = "UNKNOWN" | "GRANTED" | "DENIED";
export type EventType = "PRODUCT_VIEW" | "SEARCH" | "ADD_TO_CART";
export type RowSource = "PROFILE" | "DEFAULT";
export type FallbackReason = "ok" | "timeout" | "outage" | "kill_switch" | "opt_out";

export interface ProfileEvent {
  type: Exclude<EventType, "SEARCH">;
  productId: number;
  at: number;
}

export interface CategoryAffinity {
  name: string;
  slug: string;
  views: number;
  searches: number;
  carts: number;
}

export interface ProfileTraits {
  preferredCategories: CategoryAffinity[];
  priceMin: number | null;
  priceMax: number | null;
  recentSearches: string[];
}

export interface Segment {
  id: string;
  label: string;
}

export interface ProductRow {
  title: string;
  source: RowSource;
  reason: string | null;
  productIds: string[];
}

export interface ViewerProfile {
  id: string;
  consent: ConsentState;
  traits: ProfileTraits;
  segments: Segment[];
  eventCount: number;
}

export interface FaultSettings {
  outage: boolean;
  slow: boolean;
  killSwitch: boolean;
}

export interface Exposure {
  at: number;
  productIds: string[];
  requestId: string;
}
