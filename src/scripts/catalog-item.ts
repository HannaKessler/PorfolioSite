import { bindCarousels } from "./catalog-carousel";
import { mountConsent } from "./catalog-consent";
import { mountItemProfile, onConsentChange, prepareHood } from "../catalog-profile/client/mount";

export function mountItem(root: HTMLElement) {
  const back = root.querySelector<HTMLAnchorElement>("[data-back]");
  const input = root.querySelector<HTMLInputElement>("#os-q");
  const hero = root.querySelector<HTMLImageElement>("#os-hero");

  const query = new URLSearchParams(location.search).get("q")?.trim() ?? "";
  if (query && input) input.value = query;
  if (query && back) {
    back.href = `/projects/catalog?q=${encodeURIComponent(query)}`;
    back.textContent = "Back to results";
  }
  if (query) {
    root.querySelectorAll<HTMLAnchorElement>(".os-similar a").forEach((link) => {
      const url = new URL(link.getAttribute("href") || "", location.origin);
      url.searchParams.set("q", query);
      link.href = `${url.pathname}${url.search}`;
    });
  }
  bindCarousels(root);
  prepareHood(root);

  const productId = Number(root.getAttribute("data-product-id"));
  let refresh: (() => Promise<void>) | undefined;
  if (Number.isFinite(productId) && productId > 0) {
    void mountItemProfile(root, productId).then((mounted) => {
      refresh = mounted.refresh;
    });
  }

  mountConsent(root, async (choice) => {
    const { getProfileClient } = await import("../catalog-profile/client/mount");
    const client = await getProfileClient();
    await onConsentChange(client, choice, refresh);
  });

  root.querySelectorAll<HTMLButtonElement>("[data-image]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!hero || !button.dataset.image) return;
      hero.src = button.dataset.image;
      root.querySelectorAll("[data-image]").forEach((item) => item.classList.toggle("is-on", item === button));
    });
  });
}
