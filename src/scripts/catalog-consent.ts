import { readConsent, writeConsent, type Consent } from "./catalog-data";

export function mountConsent(root: HTMLElement, onChoice?: (choice: Consent) => void) {
  const popup = root.querySelector<HTMLElement>("#os-consent");
  const panel = root.querySelector<HTMLElement>(".os-consent-panel");
  const summary = root.querySelector<HTMLElement>("#os-consent-summary");
  const settings = root.querySelector<HTMLButtonElement>("[data-cookie-settings]");
  if (!popup || !panel || !summary) return;
  document.body.append(popup);

  function paint() {
    const choice = readConsent();
    summary.hidden = choice === null;
    summary.textContent = choice === "granted"
      ? "Accepted. Up to 8 recent searches are stored in this browser for 30 days."
      : choice === "denied"
        ? "Rejected. No searches are stored."
        : "";
    const open = choice === null || popup.classList.contains("is-open");
    popup.hidden = !open;
    if (open) panel.querySelector("button")?.focus();
  }

  function open() {
    popup.classList.add("is-open");
    paint();
  }

  function close() {
    popup.classList.remove("is-open");
    popup.hidden = true;
    settings?.focus();
  }

  settings?.addEventListener("click", open);

  popup.addEventListener("click", (event) => {
    if (event.target === popup && readConsent()) {
      close();
      return;
    }
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    const choice = target.dataset.consent as Consent | undefined;
    if (choice !== "granted" && choice !== "denied") return;
    writeConsent(choice);
    popup.classList.remove("is-open");
    onChoice?.(choice);
    paint();
    popup.hidden = true;
    settings?.focus();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !popup.hidden && readConsent()) close();
  });

  paint();
}
