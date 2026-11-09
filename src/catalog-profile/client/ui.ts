import { cardHtml, carouselHtml } from "../../scripts/catalog-html";
import { productById, type Product, type ShopRow } from "../../scripts/catalog-data";
import { bindCarousels, syncScrollers } from "../../scripts/catalog-carousel";
import type { ProfileClient, QuerySnapshot } from "./api";
import type { ProductRow } from "../types";

export function paintRecommended(slot: HTMLElement, row: ProductRow) {
  const items = row.productIds.map((id) => productById(Number(id))).filter((item): item is Product => Boolean(item));
  const shopRow: ShopRow = { title: row.title, items };
  slot.innerHTML = carouselHtml(shopRow, "");
  const section = slot.querySelector(".os-row");
  if (section) {
    section.id = "os-recommended";
    section.setAttribute("data-source", row.source.toLowerCase());
  }
  bindCarousels(slot);
  syncScrollers(slot);
}

export function paintHood(root: HTMLElement, client: ProfileClient, snapshot: QuerySnapshot | null) {
  const request = root.querySelector("[data-hood-request]");
  const response = root.querySelector("[data-hood-response]");
  const latency = root.querySelector("[data-hood-latency]");
  const fallback = root.querySelector("[data-hood-fallback]");
  const profile = root.querySelector("[data-hood-profile]");
  const exposures = root.querySelector("[data-hood-exposures]");
  const transport = root.querySelector("[data-hood-transport]");
  if (transport) transport.textContent = client.transportNote;
  if (!snapshot) return;
  if (request) request.textContent = snapshot.request;
  if (response) response.textContent = snapshot.response;
  if (latency) {
    latency.textContent = `${snapshot.elapsedMs.toFixed(1)} ms`;
  }
  if (fallback) fallback.textContent = snapshot.fallback;
  if (profile) profile.textContent = snapshot.profile ? JSON.stringify(snapshot.profile, null, 2) : "No profile in the last response.";
  if (exposures) {
    exposures.textContent = client.exposures.length
      ? client.exposures.map((item) => `${new Date(item.at).toLocaleTimeString()} · ${item.productIds.join(", ")} · ${item.requestId}`).join("\n")
      : "None yet.";
  }
}

export function recommendedCardHtml(product: Product) {
  return cardHtml(product, "");
}

export const hoodMarkup = `
<div class="os-hood-panel">
  <p class="os-hood-lead">Live data from the in-browser GraphQL profile service. Fault switches are injected for this demo.</p>
  <p class="os-hood-meta">Transport: <span data-hood-transport></span></p>
  <div class="os-hood-controls">
    <label><input type="checkbox" data-fault="killSwitch" /> Kill switch</label>
    <label><input type="checkbox" data-fault="outage" /> Simulate outage <span class="os-hood-tag">Injected fault</span></label>
    <label><input type="checkbox" data-fault="slow" /> Slow profile service <span class="os-hood-tag">Injected fault</span></label>
  </div>
  <dl class="os-hood-stats">
    <div><dt>Latency</dt><dd data-hood-latency>Not requested yet</dd></div>
    <div><dt>Fallback</dt><dd data-hood-fallback>—</dd></div>
  </dl>
  <h3>Profile</h3>
  <pre data-hood-profile>Waiting for a request.</pre>
  <h3>GraphQL request</h3>
  <pre data-hood-request></pre>
  <h3>GraphQL response</h3>
  <pre data-hood-response></pre>
  <h3>Exposures</h3>
  <pre data-hood-exposures>None yet.</pre>
</div>
`;
