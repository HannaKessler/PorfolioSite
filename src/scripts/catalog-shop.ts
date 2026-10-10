import { bindCarousels, syncScrollers } from "./catalog-carousel";
import { mountConsent } from "./catalog-consent";
import { browseRows, readConsent, readQueries, rememberQuery, forgetQuery, searchProducts, suggestions } from "./catalog-data";
import { browseHtml, esc, resultsHtml } from "./catalog-html";

function queryFromUrl() {
  return new URLSearchParams(location.search).get("q")?.trim() ?? "";
}

function setQueryInUrl(query: string) {
  const url = query ? `/projects/catalog?q=${encodeURIComponent(query)}` : "/projects/catalog";
  history.pushState(null, "", url);
}

export function mountCatalog(root: HTMLElement) {
  const stage = root.querySelector<HTMLElement>("#os-stage");
  const form = root.querySelector<HTMLFormElement>(".os-search");
  const input = root.querySelector<HTMLInputElement>("#os-q");
  const suggest = root.querySelector<HTMLElement>("#os-suggest");
  if (!stage || !form || !input || !suggest) return;

  let category = "";

  function render() {
    const query = queryFromUrl();
    input.value = query;
    suggest.hidden = true;
    suggest.innerHTML = "";
    if (query) {
      stage.innerHTML = resultsHtml(query, searchProducts(query), category);
    } else {
      category = "";
      stage.innerHTML = browseHtml(browseRows());
    }
    syncScrollers(stage);
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = input.value.trim();
    category = "";
    if (readConsent() === "granted") rememberQuery(query);
    setQueryInUrl(query);
    render();
    stage.scrollIntoView({ block: "nearest" });
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

  stage.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const forget = target.closest<HTMLButtonElement>("[data-forget]");
    if (forget?.dataset.forget) {
      forgetQuery(forget.dataset.forget);
      render();
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

  mountConsent(root, (choice) => {
    if (choice === "granted") rememberQuery(queryFromUrl());
    render();
  });
  if (queryFromUrl() && readConsent() === "granted") rememberQuery(queryFromUrl());
  if (queryFromUrl() || (readConsent() === "granted" && readQueries().length > 0)) render();
  else syncScrollers(stage);
}

