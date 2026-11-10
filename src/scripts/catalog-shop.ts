import { bindCarousels, syncScrollers } from "./catalog-carousel";
import { mountConsent } from "./catalog-consent";
import { browseRows, popularRows, readConsent, readQueries, rememberQuery, forgetQuery, searchProducts, suggestions } from "./catalog-data";
import { browseHtml, esc, resultsHtml } from "./catalog-html";
import { rerankProducts } from "../catalog-profile/recommend";
import { mountHomeProfile, onConsentChange, onSearchHistoryChange, prepareHood } from "../catalog-profile/client/mount";

function queryFromUrl() {
  return new URLSearchParams(location.search).get("q")?.trim() ?? "";
}

function setQueryInUrl(query: string) {
  const url = query ? `/projects/catalog?q=${encodeURIComponent(query)}` : "/projects/catalog";
  history.pushState(null, "", url);
}

function stageRows() {
  const featuredTitle = popularRows()[0]?.title;
  return browseRows().filter((row) => row.title !== featuredTitle || row.query);
}

export function mountCatalog(root: HTMLElement) {
  const stage = root.querySelector<HTMLElement>("#os-stage");
  const recommended = root.querySelector<HTMLElement>("#os-recommended-slot");
  const form = root.querySelector<HTMLFormElement>(".os-search");
  const input = root.querySelector<HTMLInputElement>("#os-q");
  const suggest = root.querySelector<HTMLElement>("#os-suggest");
  if (!stage || !form || !input || !suggest) return;
  prepareHood(root);

  let category = "";
  let profile: Awaited<ReturnType<typeof mountHomeProfile>> | null = null;

  function hideRecommended(hidden: boolean) {
    if (!recommended) return;
    recommended.toggleAttribute("hidden", hidden);
    recommended.toggleAttribute("data-hidden-for-search", hidden);
  }

  function render() {
    const query = queryFromUrl();
    input.value = query;
    suggest.hidden = true;
    suggest.innerHTML = "";
    if (query) {
      hideRecommended(true);
      let products = searchProducts(query);
      const traits = profile?.client.last?.profile?.traits;
      if (traits && profile?.client.last?.fallback === "ok") {
        products = rerankProducts(products, traits);
      }
      stage.innerHTML = resultsHtml(query, products, category);
    } else {
      hideRecommended(false);
      category = "";
      stage.innerHTML = browseHtml(stageRows());
    }
    syncScrollers(stage);
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const query = input.value.trim();
    category = "";
    if (readConsent() === "granted") {
      rememberQuery(query);
      if (profile) await onSearchHistoryChange(profile.client);
    }
    setQueryInUrl(query);
    render();
    stage.scrollIntoView({ block: "nearest" });
    if (profile) await profile.refresh();
  });

  input.addEventListener("input", () => {
    const matches = input.value.trim().length >= 2 ? suggestions(input.value) : [];
    if (!matches.length) {
      suggest.hidden = true;
      suggest.innerHTML = "";
      return;
    }
    suggest.innerHTML = matches
      .map((product) => `<li><button type="button" data-suggest="${esc(product.title)}">${esc(product.title)}</button></li>`)
      .join("");
    suggest.hidden = false;
  });

  suggest.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement) || !target.dataset.suggest) return;
    input.value = target.dataset.suggest;
    form.requestSubmit();
  });

  stage.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const forget = target.closest<HTMLButtonElement>("[data-forget]");
    if (forget?.dataset.forget) {
      forgetQuery(forget.dataset.forget);
      if (profile) await onSearchHistoryChange(profile.client);
      render();
      if (profile) await profile.refresh();
      return;
    }
    const chip = target.closest<HTMLButtonElement>("[data-category]");
    if (chip) {
      category = chip.dataset.category || "";
      render();
    }
  });

  bindCarousels(stage);
  window.addEventListener("resize", () => syncScrollers(stage));

  window.addEventListener("popstate", () => {
    category = "";
    render();
  });

  mountConsent(root, async (choice) => {
    if (choice === "granted") rememberQuery(queryFromUrl());
    if (profile) await onConsentChange(profile.client, choice, profile.refresh);
    render();
  });
  if (queryFromUrl() && readConsent() === "granted") rememberQuery(queryFromUrl());
  if (queryFromUrl() || (readConsent() === "granted" && readQueries().length > 0)) render();
  else syncScrollers(stage);

  void mountHomeProfile(root).then((mounted) => {
    profile = mounted;
    if (queryFromUrl()) render();
  });
}
