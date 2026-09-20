import {
  bindPasswordToggles,
  downloadShare,
  loadConfig,
  loadTurnstile,
  turnstileMarkup,
  turnstileValue,
} from "./secret-notes-shared";

export async function mountSecretNotesOpen(root: HTMLElement) {
  const publicId = new URLSearchParams(window.location.search).get("n")?.trim() || "";
  if (!publicId) {
    root.innerHTML = `<p class="sn-error">This open link is missing a note id.</p>`;
    return;
  }

  let cfg;
  try {
    cfg = await loadConfig();
  } catch {
    root.innerHTML = `<p class="sn-error">The Secret notes API is not reachable. If you are developing locally, start it on port 8787.</p>`;
    return;
  }

  loadTurnstile(cfg.turnstileSiteKey);

  root.innerHTML = `
    <p class="sn-warn">Only unlock this if you trust the person who sent the link. This demo allows <code>.txt</code>, <code>.csv</code>, and text-only PDFs. It does <strong>not</strong> run antivirus. Do not open a download from a stranger in Excel or a PDF reader.</p>
    <p class="sn-banner">Not end-to-end encrypted. Enter the password to download the note.</p>
    <form id="sn-open" class="sn-form">
      <div class="sn-col-meta">
        <label for="sn-open-password">Password</label>
        <div class="sn-pw">
          <input id="sn-open-password" name="password" type="password" autocomplete="current-password" required minlength="${cfg.passwordMinLength}" />
          <button type="button" class="sn-pw-toggle" data-for="sn-open-password" aria-label="Show password" aria-pressed="false">Show</button>
        </div>
        ${turnstileMarkup(cfg)}
        <p class="sn-error" id="sn-open-err"></p>
        <p class="sn-muted sn-open-meta" id="sn-open-meta"></p>
        <div class="sn-actions">
          <button type="submit" class="sn-btn sn-btn-primary">Unlock</button>
        </div>
      </div>
    </form>
  `;

  bindPasswordToggles(root);
  const form = root.querySelector<HTMLFormElement>("#sn-open")!;
  const err = root.querySelector("#sn-open-err")!;
  const meta = root.querySelector("#sn-open-meta")!;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    err.textContent = "";
    meta.textContent = "";
    const password = (form.elements.namedItem("password") as HTMLInputElement).value;
    if (!password) {
      err.textContent = "Enter the password.";
      return;
    }
    try {
      const result = await downloadShare(publicId, password, turnstileValue(form));
      if (result.remaining <= 0) {
        meta.textContent = "This was the final download, the secret is now gone.";
      } else {
        const left = result.remaining === 1 ? "1 download left" : `${result.remaining} downloads left`;
        meta.textContent = `${result.originalFilename} · ${left} · expires ${new Date(result.expiresAt ?? "").toLocaleString()}`;
      }
    } catch (caught) {
      err.textContent =
        caught instanceof Error ? caught.message : "Could not reach the Secret notes API.";
    }
  });
}
