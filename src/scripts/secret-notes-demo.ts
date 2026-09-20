import {
  AUP_TEXT,
  apiUrl,
  bindPasswordToggles,
  loadConfig,
  loadTurnstile,
  messageFor,
  shareLinkFor,
  turnstileMarkup,
  turnstileValue,
} from "./secret-notes-shared";

export async function mountSecretNotesDemo(root: HTMLElement) {
  const existing = new URLSearchParams(window.location.search).get("n")?.trim();
  if (existing) {
    window.location.replace(`/projects/secret-notes/open?n=${encodeURIComponent(existing)}`);
    return;
  }

  let cfg;
  try {
    cfg = await loadConfig();
  } catch {
    root.innerHTML = `<p class="sn-error">The Secret notes API is not reachable. If you are developing locally, start it on port 8787. On the live site, the API host must be deployed and PUBLIC_SECRET_NOTES_API must point at it.</p>`;
    return;
  }

  loadTurnstile(cfg.turnstileSiteKey);

  root.innerHTML = `
    <p class="sn-banner">Public demo. Only <code>.txt</code>, <code>.csv</code>, and text-only PDFs (no antivirus). Not end-to-end encrypted. Expire quickly. 18+ only. No images.</p>
    <form id="sn-send" class="sn-form">
      <div class="sn-split">
        <div class="sn-col sn-col-note">
          <label for="sn-note">Note</label>
          <textarea id="sn-note" name="note" maxlength="${cfg.maxUploadBytes}" placeholder="Type a short note"></textarea>
          <label class="sn-file-label" for="sn-file">Or attach ${cfg.allowedExtensions.join(", ")}</label>
          <div class="sn-file-row">
            <input id="sn-file" type="file" accept=".txt,.csv,.pdf,text/plain,text/csv,application/pdf" />
            <span id="sn-file-name" class="sn-muted"></span>
          </div>
        </div>
        <div class="sn-col sn-col-meta">
          <label for="sn-password">Password</label>
          <div class="sn-pw">
            <input id="sn-password" name="password" type="password" autocomplete="new-password" required minlength="${cfg.passwordMinLength}" />
            <button type="button" class="sn-pw-toggle" data-for="sn-password" aria-label="Show password" aria-pressed="false">Show</button>
          </div>
          <div class="sn-inline">
            <div>
              <label for="sn-ttl">Expires</label>
              <select id="sn-ttl" name="ttlSeconds">
                <option value="${cfg.defaultTtlSeconds}" selected>1 hour</option>
                <option value="7200">2 hours</option>
                <option value="${cfg.maxTtlSeconds}">24 hours</option>
                <option value="${cfg.minTtlSeconds}">5 minutes</option>
              </select>
            </div>
            <div>
              <label for="sn-max">Max downloads</label>
              <input id="sn-max" name="maxDownloads" type="number" min="1" max="${cfg.maxDownloadsCap}" value="${cfg.defaultMaxDownloads}" />
            </div>
          </div>
          <div class="sn-checks">
            <label class="sn-check"><input type="checkbox" id="sn-age" /> I am 18 or older</label>
            <label class="sn-check"><input type="checkbox" id="sn-aup" /> I agree to the AUP</label>
          </div>
          <details class="sn-aup">
            <summary>Read the Acceptable Use Policy</summary>
            <p>${AUP_TEXT}</p>
          </details>
          ${turnstileMarkup(cfg)}
          <p class="sn-error" id="sn-send-err"></p>
          <div class="sn-actions">
            <button type="submit" class="sn-btn sn-btn-primary" id="sn-go"${cfg.serviceDisabled ? " disabled" : ""}>Create link</button>
            <button type="button" class="sn-btn sn-btn-ghost" id="sn-clear">Clear fields</button>
          </div>
        </div>
      </div>
    </form>
    <div class="sn-link-box" id="sn-result">
      <div class="sn-link-head">Share link</div>
      <p class="sn-link-empty" id="sn-link-empty">Your link will appear here after you create a note.</p>
      <div id="sn-link-ready" hidden>
        <div class="sn-link-row">
          <code id="sn-url"></code>
          <button type="button" class="sn-btn sn-btn-ghost" id="sn-copy">Copy</button>
        </div>
        <p class="sn-muted" id="sn-link-meta"></p>
      </div>
    </div>
  `;

  const sendForm = root.querySelector<HTMLFormElement>("#sn-send")!;
  const fileInput = root.querySelector<HTMLInputElement>("#sn-file")!;
  const fileName = root.querySelector("#sn-file-name")!;
  const go = root.querySelector<HTMLButtonElement>("#sn-go")!;
  const sendErr = root.querySelector("#sn-send-err")!;
  const linkEmpty = root.querySelector("#sn-link-empty")!;
  const linkReady = root.querySelector<HTMLElement>("#sn-link-ready")!;
  const urlEl = root.querySelector("#sn-url")!;
  const linkMeta = root.querySelector("#sn-link-meta")!;
  let file: File | null = null;

  bindPasswordToggles(root);

  if (cfg.serviceDisabled) {
    sendErr.textContent = messageFor("service_disabled");
  }

  fileInput.addEventListener("change", () => {
    file = fileInput.files?.[0] ?? null;
    fileName.textContent = file?.name ?? "";
  });

  sendForm.addEventListener("dragover", (e) => e.preventDefault());
  sendForm.addEventListener("drop", (e) => {
    e.preventDefault();
    const dropped = e.dataTransfer?.files[0];
    if (!dropped) return;
    if (/\.(png|jpe?g|gif|webp|svg)$/i.test(dropped.name) || dropped.type.startsWith("image/")) {
      sendErr.textContent = "Images are not supported.";
      return;
    }
    file = dropped;
    fileName.textContent = dropped.name;
  });

  const reasonBlocked = (): string | null => {
    if (cfg.serviceDisabled) return messageFor("service_disabled");
    const note = (sendForm.elements.namedItem("note") as HTMLTextAreaElement).value.trim();
    if (!file && !note) return "Type a note or attach a .txt, .csv, or text-only PDF.";
    const pw = (sendForm.elements.namedItem("password") as HTMLInputElement).value;
    if (!pw) return "Enter a password.";
    if (!/^[\x20-\x7E]+$/.test(pw)) {
      return "Use standard characters only (letters, numbers, and common punctuation).";
    }
    if (!(root.querySelector<HTMLInputElement>("#sn-age")!).checked) {
      return "Confirm that you are 18 or older.";
    }
    if (!(root.querySelector<HTMLInputElement>("#sn-aup")!).checked) {
      return "Agree to the Acceptable Use Policy to continue.";
    }
    return null;
  };

  sendForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const blocked = reasonBlocked();
    if (blocked) {
      sendErr.textContent = blocked;
      return;
    }
    sendErr.textContent = "";
    go.disabled = true;
    try {
      const fd = new FormData();
      const note = (sendForm.elements.namedItem("note") as HTMLTextAreaElement).value;
      if (file) fd.set("file", file, file.name);
      else fd.set("note", note);
      fd.set("password", (sendForm.elements.namedItem("password") as HTMLInputElement).value);
      fd.set("ttlSeconds", (sendForm.elements.namedItem("ttlSeconds") as HTMLSelectElement).value);
      fd.set("maxDownloads", (sendForm.elements.namedItem("maxDownloads") as HTMLInputElement).value);
      fd.set("aupAccepted", "true");
      fd.set("turnstileToken", turnstileValue(sendForm));
      const res = await fetch(apiUrl("/uploads"), { method: "POST", body: fd });
      const json = (await res.json()) as {
        category?: string;
        errorCategory?: string;
        publicId?: string;
        expiresAt?: string;
        maxDownloads?: number;
      };
      if (!res.ok || !json.publicId) {
        sendErr.textContent = messageFor(json.category || json.errorCategory || "");
        return;
      }
      urlEl.textContent = shareLinkFor(json.publicId);
      linkMeta.textContent = `Expires ${new Date(json.expiresAt as string).toLocaleString()} · ${json.maxDownloads} download(s). Send the password separately.`;
      linkEmpty.setAttribute("hidden", "");
      linkReady.hidden = false;
    } catch {
      sendErr.textContent = "Could not reach the Secret notes API.";
    } finally {
      go.disabled = false;
    }
  });

  root.querySelector("#sn-clear")!.addEventListener("click", () => {
    sendForm.reset();
    file = null;
    const pw = root.querySelector<HTMLInputElement>("#sn-password")!;
    pw.type = "password";
    const toggle = root.querySelector<HTMLButtonElement>('[data-for="sn-password"]')!;
    toggle.setAttribute("aria-pressed", "false");
    toggle.setAttribute("aria-label", "Show password");
    fileInput.value = "";
    fileName.textContent = "";
    sendErr.textContent = "";
    urlEl.textContent = "";
    linkMeta.textContent = "";
    linkReady.hidden = true;
    linkEmpty.removeAttribute("hidden");
  });

  root.querySelector("#sn-copy")!.addEventListener("click", async () => {
    const text = urlEl.textContent || "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      linkMeta.textContent = "Copied. Send this link and the password separately.";
    } catch {
      linkMeta.textContent = "Copy failed. Select the link and copy it manually.";
    }
  });
}
