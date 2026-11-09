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
  const latencyBadge = root.querySelector<HTMLElement>("[data-hood-latency-badge]");
  const fallbackBadge = root.querySelector<HTMLElement>("[data-hood-fallback-badge]");
  const profile = root.querySelector("[data-hood-profile]");
  const exposures = root.querySelector("[data-hood-exposures]");
  const transport = root.querySelector("[data-hood-transport]");
  if (transport) transport.textContent = client.transportNote;
  if (!snapshot) {
    latencyBadge?.setAttribute("hidden", "");
    fallbackBadge?.setAttribute("hidden", "");
    return;
  }
  if (request) request.textContent = snapshot.request;
  if (response) response.textContent = snapshot.response;
  const latencyText = `${snapshot.elapsedMs.toFixed(1)} ms`;
  if (latency) latency.textContent = latencyText;
  if (fallback) fallback.textContent = snapshot.fallback;
  if (latencyBadge) {
    latencyBadge.textContent = latencyText;
    latencyBadge.hidden = false;
  }
  if (fallbackBadge) {
    fallbackBadge.textContent = snapshot.fallback.replaceAll("_", " ");
    fallbackBadge.hidden = false;
  }
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
