import { deriveSegments, deriveTraits, eventCount, hasUsableProfile } from "./traits";
import { defaultRecommendedIds, defaultRecommendedTitle, recommendIds, recommendationReason } from "./recommend";
import type { ConsentState, Exposure, FaultSettings, ProfileEvent, ProductRow, ViewerProfile } from "./types";

export interface PersistedProfile {
  id: string;
  consent: ConsentState;
  searches: string[];
  events: ProfileEvent[];
  exposures: Exposure[];
}

export class ProfileStore {
  id = "browser-visitor";
  consent: ConsentState = "UNKNOWN";
  searches: string[] = [];
  events: ProfileEvent[] = [];
  exposures: Exposure[] = [];
  faults: FaultSettings = { outage: false, slow: false, killSwitch: false };
  requestCount = 0;

  snapshot(): PersistedProfile {
    return {
      id: this.id,
      consent: this.consent,
      searches: [...this.searches],
      events: [...this.events],
      exposures: [...this.exposures],
    };
  }

  restore(data: PersistedProfile) {
    this.id = data.id;
    this.consent = data.consent;
    this.searches = [...data.searches];
    this.events = [...data.events];
    this.exposures = [...data.exposures];
  }

  erase() {
    this.searches = [];
    this.events = [];
    this.exposures = [];
  }

  setConsent(granted: boolean) {
    this.consent = granted ? "GRANTED" : "DENIED";
    if (!granted) this.erase();
  }

  /** Replace the search list with the shop's existing history. This is not a second log. */
  syncSearches(queries: string[]) {
    if (this.consent !== "GRANTED") return;
    this.searches = [...queries];
  }

  track(type: ProfileEvent["type"], productId: number) {
    if (this.consent !== "GRANTED") return;
    this.events.push({ type, productId, at: Date.now() });
  }

  recordExposure(productIds: string[], requestId: string) {
    if (this.consent !== "GRANTED") return;
    this.exposures.push({ at: Date.now(), productIds, requestId });
  }

  profile(): ViewerProfile {
    const traits = deriveTraits(this.searches, this.events);
    return {
      id: this.id,
      consent: this.consent,
      traits,
      segments: deriveSegments(traits),
      eventCount: eventCount(this.searches, this.events),
    };
  }

  recommended(limit = 12): ProductRow {
    const traits = deriveTraits(this.searches, this.events);
    const usable = this.consent === "GRANTED" && hasUsableProfile(traits);
    if (!usable) {
      return {
        title: defaultRecommendedTitle(),
        source: "DEFAULT",
        reason: null,
        productIds: defaultRecommendedIds(limit),
      };
    }
    const viewedIds = this.events.filter((event) => event.type === "PRODUCT_VIEW").map((event) => event.productId);
    return {
      title: "Recommended for You",
      source: "PROFILE",
      reason: recommendationReason(traits),
      productIds: recommendIds(traits, viewedIds, limit),
    };
  }

  nextRequestId() {
    this.requestCount += 1;
    return `req-${this.requestCount}`;
  }
}
