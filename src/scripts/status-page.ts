import { API, apiUrl } from "./secret-notes-shared";

const HISTORY_KEY = "hk-status-probes";
const HISTORY_MAX = 20;
const LATENCY_SLO_MS = 1000;
const QUOTA_WARN = 0.8;
const POLL_MS = 20_000;

type Quota = {
  activeBytes: number;
  maxActiveBytes: number;
  uploadsToday: number;
  maxUploadsPerDay: number;
  bytesToday: number;
  maxBytesPerDay: number;
};

type StatusPayload = {
  ok: boolean;
  serviceDisabled?: boolean;
  checkedAt?: string;
  antivirus?: string;
  quota?: Quota;
};

type Probe = {
  at: string;
  ok: boolean;
  ms: number;
  source: "status" | "config" | "down";
  serviceDisabled: boolean;
};

type Tone = "ok" | "paused" | "degraded" | "down";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function loadHistory(): Probe[] {
  try {
    const raw = sessionStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Probe[];
    return Array.isArray(parsed) ? parsed.slice(-HISTORY_MAX) : [];
  } catch {
    return [];
  }
}

function saveHistory(rows: Probe[]) {
  sessionStorage.setItem(HISTORY_KEY, JSON.stringify(rows.slice(-HISTORY_MAX)));
}

function toneFor(probe: Probe, quota?: Quota): Tone {
  if (!probe.ok) return "down";
  if (probe.serviceDisabled) return "paused";
  const quotaHot =
    quota &&
    (quota.activeBytes / quota.maxActiveBytes >= QUOTA_WARN ||
      quota.uploadsToday / quota.maxUploadsPerDay >= QUOTA_WARN);
  if (probe.ms > LATENCY_SLO_MS || quotaHot) return "degraded";
  return "ok";
}

function labelFor(tone: Tone): string {
  if (tone === "ok") return "Operational";
  if (tone === "paused") return "Uploads paused";
  if (tone === "degraded") return "Degraded";
  return "Unreachable";
}

function copyFor(tone: Tone): string {
  if (tone === "ok") return "The Secret notes API answered this probe. Uploads are open.";
  if (tone === "paused") {
    return "The API is up, but the kill switch is on. Existing notes can still be opened until they expire.";
  }
  if (tone === "degraded") {
    return "The API answered, but latency or quota is over the demo target.";
  }
  return "This page could not reach the Secret notes API. Locally, start it on port 8787. On the live site, PUBLIC_SECRET_NOTES_API must point at the deployed host.";
}

function meter(value: number, max: number): string {
  const pct = max <= 0 ? 0 : Math.min(100, Math.round((value / max) * 100));
  return `<div class="st-meter" role="meter" aria-valuemin="0" aria-valuemax="${max}" aria-valuenow="${value}">
    <span style="width:${pct}%"></span>
  </div>
  <p class="st-meter-label">${pct}% of ${max.toLocaleString()}</p>`;
}

async function fetchWithTimeout(url: string): Promise<Response> {
  return fetch(url, { cache: "no-store", signal: AbortSignal.timeout(4000) });
}

async function probeOnce(): Promise<{ probe: Probe; payload?: StatusPayload }> {
  const started = performance.now();
  try {
    const res = await fetchWithTimeout(apiUrl("/status"));
    const ms = Math.round(performance.now() - started);
    if (res.ok) {
      const payload = (await res.json()) as StatusPayload;
      return {
        payload,
        probe: {
          at: new Date().toISOString(),
          ok: Boolean(payload.ok),
          ms,
          source: "status",
          serviceDisabled: Boolean(payload.serviceDisabled),
        },
      };
    }
  } catch {
    // Fall through to config so an older API still shows something.
  }

  const fallbackStart = performance.now();
  try {
    const res = await fetchWithTimeout(apiUrl("/config"));
    if (!res.ok) throw new Error("config");
    const cfg = (await res.json()) as { serviceDisabled?: boolean };
    return {
      probe: {
        at: new Date().toISOString(),
        ok: true,
        ms: Math.round(performance.now() - fallbackStart),
        source: "config",
        serviceDisabled: Boolean(cfg.serviceDisabled),
      },
    };
  } catch {
    return {
      probe: {
        at: new Date().toISOString(),
        ok: false,
        ms: Math.round(performance.now() - started),
        source: "down",
        serviceDisabled: false,
      },
    };
  }
}

function render(root: HTMLElement, probe: Probe, history: Probe[], payload?: StatusPayload) {
  const tone = toneFor(probe, payload?.quota);
  const sessionOk = history.filter((row) => row.ok).length;
  const sessionPct = history.length ? Math.round((sessionOk / history.length) * 100) : 0;
  const avgMs = history.length
    ? Math.round(history.reduce((sum, row) => sum + row.ms, 0) / history.length)
    : probe.ms;

  const quota = payload?.quota;
  const sourceNote =
    probe.source === "config"
      ? "Quota is hidden until the API with /v1/status is deployed. This probe used /v1/config."
      : `Talking to ${API}.`;

  root.innerHTML = `
    <div class="st-banner st-banner-${tone}">
      <p class="st-kicker">Secret notes</p>
      <p class="st-state">${labelFor(tone)}</p>
      <p>${copyFor(tone)}</p>
    </div>
    <div class="st-stats">
      <div class="st-stat">
        <p class="st-stat-label">This probe</p>
        <p class="st-stat-value">${probe.ok ? `${probe.ms} ms` : "Failed"}</p>
      </div>
      <div class="st-stat">
        <p class="st-stat-label">Session average</p>
        <p class="st-stat-value">${avgMs} ms</p>
      </div>
      <div class="st-stat">
        <p class="st-stat-label">Session reachability</p>
        <p class="st-stat-value">${history.length ? `${sessionPct}%` : "—"}</p>
      </div>
      <div class="st-stat">
        <p class="st-stat-label">Uploads</p>
        <p class="st-stat-value">${probe.ok ? (probe.serviceDisabled ? "Paused" : "Open") : "Unknown"}</p>
      </div>
    </div>
    ${
      quota
        ? `<div class="st-quota">
            <div>
              <h3>Active storage</h3>
              <p>${formatBytes(quota.activeBytes)} of ${formatBytes(quota.maxActiveBytes)}</p>
              ${meter(quota.activeBytes, quota.maxActiveBytes)}
            </div>
            <div>
              <h3>Uploads today</h3>
              <p>${quota.uploadsToday} of ${quota.maxUploadsPerDay}</p>
              ${meter(quota.uploadsToday, quota.maxUploadsPerDay)}
            </div>
          </div>`
        : ""
    }
    <div class="st-toolbar">
      <button type="button" class="button button-ghost" id="st-refresh">Check again</button>
      <p class="st-muted">${sourceNote} ${payload?.antivirus ? `Scan path: ${payload.antivirus}.` : ""} History stays in this browser.</p>
    </div>
    <table class="st-table">
      <caption>Probes from this tab</caption>
      <thead>
        <tr><th>Time</th><th>Result</th><th>Latency</th><th>Source</th></tr>
      </thead>
      <tbody>
        ${
          history.length
            ? history
                .slice()
                .reverse()
                .map((row) => {
                  const time = new Date(row.at).toLocaleTimeString();
                  return `<tr>
                    <td>${time}</td>
                    <td>${row.ok ? (row.serviceDisabled ? "Paused" : "OK") : "Down"}</td>
                    <td>${row.ms} ms</td>
                    <td>${row.source}</td>
                  </tr>`;
                })
                .join("")
            : `<tr><td colspan="4">No probes yet.</td></tr>`
        }
      </tbody>
    </table>
  `;

  root.querySelector("#st-refresh")?.addEventListener("click", () => {
    void run(root);
  });
}

export async function mountStatusPage(root: HTMLElement) {
  const runAndPaint = async () => {
    const { probe, payload } = await probeOnce();
    const history = [...loadHistory(), probe];
    saveHistory(history);
    render(root, probe, history, payload);
  };

  await runAndPaint();

  const timer = window.setInterval(() => {
    if (document.hidden) return;
    void runAndPaint();
  }, POLL_MS);

  window.addEventListener("pagehide", () => window.clearInterval(timer), { once: true });
}

async function run(root: HTMLElement) {
  const { probe, payload } = await probeOnce();
  const history = [...loadHistory(), probe];
  saveHistory(history);
  render(root, probe, history, payload);
}
