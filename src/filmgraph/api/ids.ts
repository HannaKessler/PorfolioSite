import { ApiError } from "../db/access";

/** Accepts "25188" or "Q25188" and returns 25188. */
export function parseId(value: string | number, label = "id"): number {
  const text = String(value).trim();
  const match = /^Q?(\d{1,10})$/i.exec(text);
  if (!match) throw new ApiError("BAD_USER_INPUT", `${label} must be a numeric Wikidata ID like 25188 or Q25188.`);
  return Number(match[1]);
}

export function optionalId(value: string | number | null | undefined, label?: string): number | null {
  return value == null || value === "" ? null : parseId(value, label);
}
