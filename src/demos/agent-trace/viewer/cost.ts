/**
 * What-if cost: the visitor's own prices (per 1M tokens) multiplied by token
 * counts the runtime actually reported. There are no default prices.
 */
export interface Prices {
  inputPerM?: number;
  outputPerM?: number;
}

export function parsePrice(text: string): number | undefined {
  if (text.trim() === "") return undefined;
  const v = Number(text);
  return Number.isFinite(v) && v >= 0 ? v : undefined;
}

/** Undefined unless both prices are set. */
export function whatIfCost(inputTokens: number, outputTokens: number, prices: Prices): number | undefined {
  if (prices.inputPerM === undefined || prices.outputPerM === undefined) return undefined;
  return (inputTokens / 1e6) * prices.inputPerM + (outputTokens / 1e6) * prices.outputPerM;
}

export function formatUsd(v: number): string {
  if (v === 0) return "$0";
  if (v < 0.0001) return `$${v.toExponential(2)}`;
  return `$${v < 1 ? v.toFixed(6).replace(/0+$/, "").replace(/\.$/, "") : v.toFixed(2)}`;
}

const KEY = "agent-trace-viewer:what-if-prices";

export function loadPrices(storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): Prices {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return {};
    const p = JSON.parse(raw);
    return { inputPerM: typeof p.inputPerM === "number" ? p.inputPerM : undefined, outputPerM: typeof p.outputPerM === "number" ? p.outputPerM : undefined };
  } catch {
    return {};
  }
}

export function savePrices(prices: Prices, storage: Pick<Storage, "setItem"> | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(KEY, JSON.stringify(prices));
  } catch {
    // Storage may be unavailable (private mode); prices then last for this visit only.
  }
}
