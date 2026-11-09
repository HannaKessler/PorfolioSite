import { readConsent, readQueries, type Consent } from "../../scripts/catalog-data";
import { connect } from "./connection";
import { ProfileClient } from "./api";
import { paintHood, paintRecommended } from "./ui";
import type { FaultSettings } from "../types";

let clientPromise: Promise<ProfileClient> | null = null;

export function getProfileClient() {
  if (!clientPromise) {
    clientPromise = connect().then((connection) => new ProfileClient(connection));
  }
  return clientPromise;
}

export async function syncShopHistory(client: ProfileClient) {
  const consent = readConsent();
  if (consent === "granted") {
    await client.setConsent(true);
    await client.syncSearchHistory(readQueries());
    return;
  }
  if (consent === "denied") {
    await client.setConsent(false);
  }
}

export function readUiFaults(root: HTMLElement): FaultSettings {
  const flag = (name: keyof FaultSettings) =>
    Boolean(root.querySelector<HTMLInputElement>(`[data-fault="${name}"]`)?.checked);
  return { outage: flag("outage"), slow: flag("slow"), killSwitch: flag("killSwitch") };
}

function hoodScope(root: HTMLElement) {
  return (root.closest(".container") as HTMLElement | null) ?? root;
}

export function prepareHood(root: HTMLElement) {
  const scope = hoodScope(root);
  const toggle = scope.querySelector<HTMLButtonElement>("[data-hood-toggle]");
  const panel = scope.querySelector<HTMLElement>("#os-hood-panel");
  if (!toggle || !panel) return;
  if (!toggle.dataset.bound) {
    toggle.addEventListener("click", () => {
      const open = panel.hasAttribute("hidden");
      panel.toggleAttribute("hidden", !open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    toggle.dataset.bound = "true";
  }
}

function wireHood(root: HTMLElement, client: ProfileClient, refetch: () => Promise<void>) {
  const scope = hoodScope(root);
  const hood = scope.querySelector<HTMLElement>("#os-hood");
  const panel = scope.querySelector<HTMLElement>("#os-hood-panel");
  const toggle = scope.querySelector<HTMLButtonElement>("[data-hood-toggle]");
  if (!hood || !panel || !toggle) return;
  prepareHood(root);
  paintHood(scope, client, client.last);
  if (hood.dataset.wired) return;
  hood.dataset.wired = "true";

  hood.addEventListener("change", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !target.dataset.fault) return;
    const key = target.dataset.fault as "outage" | "slow" | "killSwitch";
    await client.setFaults({ [key]: target.checked });
    await refetch();
  });
}

export async function mountHomeProfile(root: HTMLElement) {
  prepareHood(root);
  const slot = root.querySelector<HTMLElement>("#os-recommended-slot");
  const client = await getProfileClient();
  await syncShopHistory(client);
  await client.setFaults(readUiFaults(root));

  const refresh = async () => {
    const consent = readConsent();
    const { snapshot, data } = await client.recommendedForYou();
    const canPersonalize =
      consent === "granted" &&
      slot &&
      !slot.hasAttribute("data-hidden-for-search") &&
      data?.recommendedForYou.source === "PROFILE" &&
      data.recommendedForYou.productIds.length;
    if (canPersonalize && slot && data) {
      paintRecommended(slot, data.recommendedForYou);
      const requestId = `exp-${Date.now()}`;
      await client.recordExposure(data.recommendedForYou.productIds, requestId);
    }
    const painted =
      consent === "denied" && snapshot.fallback === "ok"
        ? { ...snapshot, fallback: "opt_out" as const }
        : snapshot;
    paintHood(root, client, painted);
  };

  wireHood(root, client, refresh);
  await refresh();
  return { client, refresh };
}

export async function mountItemProfile(root: HTMLElement, productId: number) {
  prepareHood(root);
  const client = await getProfileClient();
  await syncShopHistory(client);
  await client.setFaults(readUiFaults(root));
  const refresh = async () => {
    const consent = readConsent();
    const { snapshot } = await client.recommendedForYou(4);
    const painted =
      consent === "denied" && snapshot.fallback === "ok"
        ? { ...snapshot, fallback: "opt_out" as const }
        : snapshot;
    paintHood(root, client, painted);
  };
  wireHood(root, client, refresh);

  if (readConsent() === "granted") {
    await client.trackEvent("PRODUCT_VIEW", productId);
  }

  root.querySelector<HTMLButtonElement>("[data-add-cart]")?.addEventListener("click", async () => {
    if (readConsent() !== "granted") {
      root.querySelector<HTMLElement>("[data-cart-status]")?.replaceChildren(
        document.createTextNode("Accept cookies to include this in your profile. Nothing here is for sale."),
      );
      root.querySelector<HTMLElement>("[data-cart-status]")?.removeAttribute("hidden");
      return;
    }
    await client.trackEvent("ADD_TO_CART", productId);
    const status = root.querySelector<HTMLElement>("[data-cart-status]");
    if (status) {
      status.hidden = false;
      status.textContent = "Added to your sample cart. Nothing here is for sale.";
    }
    await refresh();
  });

  await refresh();
  return { client, refresh };
}

export async function onConsentChange(client: ProfileClient, choice: Consent, refresh?: () => Promise<void>) {
  await client.setConsent(choice === "granted");
  if (choice === "granted") await client.syncSearchHistory(readQueries());
  await refresh?.();
}

export async function onSearchHistoryChange(client: ProfileClient) {
  if (readConsent() === "granted") await client.syncSearchHistory(readQueries());
}
