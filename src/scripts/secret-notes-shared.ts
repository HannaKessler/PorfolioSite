type PublicConfig = {
  maxUploadBytes: number;
  allowedExtensions: string[];
  minTtlSeconds: number;
  maxTtlSeconds: number;
  defaultTtlSeconds: number;
  defaultMaxDownloads: number;
  maxDownloadsCap: number;
  passwordMinLength: number;
  turnstileSiteKey: string;
  serviceDisabled: boolean;
};

export const API = import.meta.env.PUBLIC_SECRET_NOTES_API || "/v1";

export function apiUrl(path: string) {
  return `${API}${path}`;
}

export const AUP_TEXT = `You must be 18 or older. You may send a short text note, .txt, .csv, or a text-only PDF.

You may not upload malware, CSAM or any content involving minors, stolen credentials, images, or PDFs that contain images (logos and scans count). Do not use this as a warez/file drop or try to bypass scanning, rate limits, or expiry.

Uploads are scanned. The operator can read notes during scan. The service may be disabled without notice.`;

export function messageFor(category: string): string {
  const map: Record<string, string> = {
    too_large: "That file is too large.",
    type_not_allowed: "That file type is not allowed.",
    pdf_contains_image: "PDFs must not contain images (including logos and scans).",
    malware: "The upload was rejected.",
    policy_violation: "The upload was rejected.",
    quota_exceeded: "The demo is at capacity. Try again after older notes expire.",
    invalid_password: "Use standard characters only (letters, numbers, and common punctuation).",
    aup_required: "You must accept the Acceptable Use Policy.",
    turnstile: "Please complete the challenge and try again.",
    rate_limited: "Too many attempts. Wait and retry.",
    service_disabled: "This service is temporarily disabled.",
  };
  return map[category] || "The request could not be completed.";
}

export function shareLinkFor(publicId: string) {
  return `${window.location.origin}/projects/secret-notes/open?n=${encodeURIComponent(publicId)}`;
}

export function bindPasswordToggles(root: ParentNode) {
  root.querySelectorAll<HTMLButtonElement>(".sn-pw-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = document.getElementById(btn.dataset.for ?? "") as HTMLInputElement | null;
      if (!input) return;
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.setAttribute("aria-pressed", String(show));
      btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
    });
  });
}

export function turnstileValue(form: HTMLFormElement): string {
  const hidden = form.querySelector<HTMLInputElement>('input[name="turnstileToken"]');
  if (hidden) return hidden.value;
  const w = form.querySelector<HTMLInputElement>('[name="cf-turnstile-response"]');
  return w?.value || "";
}

export function loadTurnstile(siteKey: string) {
  if (siteKey === "dev-skip") return;
  if (document.querySelector('script[src*="turnstile"]')) return;
  const s = document.createElement("script");
  s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
  s.async = true;
  document.head.appendChild(s);
}

export function turnstileMarkup(cfg: PublicConfig) {
  if (cfg.turnstileSiteKey === "dev-skip") {
    return `<input type="hidden" name="turnstileToken" value="dev-skip" />`;
  }
  return `<div class="cf-turnstile" data-sitekey="${cfg.turnstileSiteKey}"></div>`;
}

export async function loadConfig(): Promise<PublicConfig> {
  const res = await fetch(apiUrl("/config"));
  if (!res.ok) throw new Error("config");
  return (await res.json()) as PublicConfig;
}

export async function downloadShare(
  publicId: string,
  password: string,
  turnstileToken: string,
): Promise<{ remaining: number; originalFilename: string; expiresAt?: string }> {
  const res = await fetch(apiUrl(`/shares/${publicId}/unlock`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password, turnstileToken }),
  });
  const json = (await res.json()) as {
    grant?: string;
    originalFilename?: string;
    expiresAt?: string;
  };
  if (!res.ok || !json.grant) {
    throw new Error("Not found or expired.");
  }
  const fileRes = await fetch(
    apiUrl(`/shares/${publicId}/file?grant=${encodeURIComponent(json.grant)}`),
  );
  if (!fileRes.ok) {
    throw new Error("The download failed or the secret is already gone.");
  }
  const remaining = Number(fileRes.headers.get("X-Remaining-Downloads") ?? "0");
  const blob = await fileRes.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = json.originalFilename || "note.txt";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
  return {
    remaining,
    originalFilename: json.originalFilename || "note.txt",
    expiresAt: json.expiresAt,
  };
}
