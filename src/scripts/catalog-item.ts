import { bindCarousels } from "./catalog-carousel";
import { mountConsent } from "./catalog-consent";

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

  mountConsent(root);

  root.querySelectorAll<HTMLButtonElement>("[data-image]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!hero || !button.dataset.image) return;
      hero.src = button.dataset.image;
      root.querySelectorAll("[data-image]").forEach((item) => item.classList.toggle("is-on", item === button));
    });
  });
}
