/**
 * OTLP-JSON normalization. Accepts what OTLP/JSON producers emit (hex or base64
 * IDs, string or number nanosecond timestamps, int64 as string or number) and
 * produces one canonical form, so ingest → export → ingest is a fixed point.
 */

export type AttrValue = string | number | boolean | null | AttrValue[] | { [key: string]: AttrValue };

export interface OtlpAnyValue {
  stringValue?: string;
  boolValue?: boolean;
  intValue?: string | number;
  doubleValue?: number;
  arrayValue?: { values?: OtlpAnyValue[] };
  kvlistValue?: { values?: OtlpKeyValue[] };
  bytesValue?: string;
}
export interface OtlpKeyValue {
  key: string;
  value?: OtlpAnyValue;
}
export interface OtlpEvent {
  timeUnixNano: string;
  name: string;
  attributes?: OtlpKeyValue[];
  droppedAttributesCount?: number;
}
export interface OtlpSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  traceState?: string;
  name: string;
  kind?: number;
  startTimeUnixNano: string;
  endTimeUnixNano?: string;
  attributes?: OtlpKeyValue[];
  droppedAttributesCount?: number;
  events?: OtlpEvent[];
  droppedEventsCount?: number;
  status?: { code?: number; message?: string };
  links?: unknown[];
  droppedLinksCount?: number;
  flags?: number;
}
export interface OtlpResource {
  attributes?: OtlpKeyValue[];
  droppedAttributesCount?: number;
}
export interface OtlpScope {
  name?: string;
  version?: string;
  attributes?: OtlpKeyValue[];
  droppedAttributesCount?: number;
}
export interface OtlpExportRequest {
  resourceSpans: {
    resource?: OtlpResource;
    schemaUrl?: string;
    scopeSpans?: { scope?: OtlpScope; schemaUrl?: string; spans?: OtlpSpan[] }[];
  }[];
}

export interface NormEvent {
  name: string;
  timeNs: bigint;
  attrs: Record<string, AttrValue>;
}

export interface NormSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  /** OTLP SpanKind: 1 internal, 2 server, 3 client, 4 producer, 5 consumer. */
  kind: number;
  startNs: bigint;
  /** null while the span is still open. */
  endNs: bigint | null;
  attrs: Record<string, AttrValue>;
  events: NormEvent[];
  /** OTLP status code: 0 unset, 1 ok, 2 error. */
  status: { code: number; message?: string };
  resourceKey: string;
  scopeKey: string;
  /** The canonical OTLP form, used for export. */
  raw: OtlpSpan;
}

const HEX = /^[0-9a-f]*$/i;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

function base64ToHex(b64: string): string {
  const bin = atob(b64);
  let out = "";
  for (let i = 0; i < bin.length; i++) out += bin.charCodeAt(i).toString(16).padStart(2, "0");
  return out;
}

/** Normalizes a trace or span ID to lowercase hex of the given byte length. */
export function normalizeId(id: unknown, bytes: number): string | undefined {
  if (typeof id !== "string" || id === "") return undefined;
  const hexLen = bytes * 2;
  if (id.length === hexLen && HEX.test(id)) return id.toLowerCase();
  if (B64.test(id)) {
    try {
      const hex = base64ToHex(id);
      if (hex.length === hexLen) return hex;
    } catch {
      // fall through
    }
  }
  return undefined;
}

/** Nanosecond timestamp as a decimal string. */
export function normalizeNanos(value: unknown): string | undefined {
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value).toString();
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return BigInt(Math.round(value)).toString();
  if (value && typeof value === "object" && "low" in value && "high" in value) {
    const { low, high } = value as { low: number; high: number };
    return ((BigInt(high >>> 0) << 32n) | BigInt(low >>> 0)).toString();
  }
  return undefined;
}

function normalizeAnyValue(v: OtlpAnyValue | undefined): OtlpAnyValue {
  if (!v || typeof v !== "object") return {};
  if (v.stringValue !== undefined) return { stringValue: String(v.stringValue) };
  if (v.boolValue !== undefined) return { boolValue: Boolean(v.boolValue) };
  if (v.intValue !== undefined) return { intValue: String(v.intValue) };
  if (v.doubleValue !== undefined) return { doubleValue: Number(v.doubleValue) };
  if (v.arrayValue !== undefined) return { arrayValue: { values: (v.arrayValue.values ?? []).map(normalizeAnyValue) } };
  if (v.kvlistValue !== undefined) return { kvlistValue: { values: normalizeKeyValues(v.kvlistValue.values) } };
  if (v.bytesValue !== undefined) return { bytesValue: String(v.bytesValue) };
  return {};
}

export function normalizeKeyValues(kvs: OtlpKeyValue[] | undefined): OtlpKeyValue[] {
  if (!Array.isArray(kvs)) return [];
  return kvs.filter((kv) => kv && typeof kv.key === "string").map((kv) => ({ key: kv.key, value: normalizeAnyValue(kv.value) }));
}

export function decodeAnyValue(v: OtlpAnyValue | undefined): AttrValue {
  if (!v) return null;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.boolValue !== undefined) return v.boolValue;
  if (v.intValue !== undefined) return Number(v.intValue);
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.arrayValue) return (v.arrayValue.values ?? []).map(decodeAnyValue);
  if (v.kvlistValue) return decodeAttributes(v.kvlistValue.values);
  if (v.bytesValue !== undefined) return v.bytesValue;
  return null;
}

export function decodeAttributes(kvs: OtlpKeyValue[] | undefined): Record<string, AttrValue> {
  const out: Record<string, AttrValue> = {};
  for (const kv of kvs ?? []) out[kv.key] = decodeAnyValue(kv.value);
  return out;
}

export class SpanFormatError extends Error {}

/** Canonical OTLP span. Throws SpanFormatError for spans that cannot be used. */
export function normalizeSpan(span: OtlpSpan): OtlpSpan {
  if (!span || typeof span !== "object") throw new SpanFormatError("span is not an object");
  const traceId = normalizeId(span.traceId, 16);
  const spanId = normalizeId(span.spanId, 8);
  if (!traceId) throw new SpanFormatError("invalid traceId");
  if (!spanId) throw new SpanFormatError("invalid spanId");
  const parentSpanId = span.parentSpanId ? normalizeId(span.parentSpanId, 8) : undefined;
  if (span.parentSpanId && !parentSpanId) throw new SpanFormatError("invalid parentSpanId");
  const start = normalizeNanos(span.startTimeUnixNano);
  if (!start) throw new SpanFormatError("invalid startTimeUnixNano");
  const end = span.endTimeUnixNano === undefined ? "0" : normalizeNanos(span.endTimeUnixNano);
  if (end === undefined) throw new SpanFormatError("invalid endTimeUnixNano");
  const out: OtlpSpan = {
    traceId,
    spanId,
    ...(parentSpanId ? { parentSpanId } : {}),
    ...(span.traceState ? { traceState: span.traceState } : {}),
    name: typeof span.name === "string" ? span.name : "",
    kind: typeof span.kind === "number" ? span.kind : 0,
    startTimeUnixNano: start,
    endTimeUnixNano: end,
    attributes: normalizeKeyValues(span.attributes),
    droppedAttributesCount: span.droppedAttributesCount ?? 0,
    events: (span.events ?? []).map((e) => ({
      timeUnixNano: normalizeNanos(e.timeUnixNano) ?? start,
      name: String(e.name ?? ""),
      attributes: normalizeKeyValues(e.attributes),
      droppedAttributesCount: e.droppedAttributesCount ?? 0,
    })),
    droppedEventsCount: span.droppedEventsCount ?? 0,
    status: { code: span.status?.code ?? 0, ...(span.status?.message ? { message: span.status.message } : {}) },
    links: Array.isArray(span.links) ? span.links : [],
    droppedLinksCount: span.droppedLinksCount ?? 0,
    ...(typeof span.flags === "number" ? { flags: span.flags } : {}),
  };
  return out;
}

export function toNormSpan(raw: OtlpSpan, resourceKey: string, scopeKey: string): NormSpan {
  const end = BigInt(raw.endTimeUnixNano ?? "0");
  return {
    traceId: raw.traceId,
    spanId: raw.spanId,
    parentSpanId: raw.parentSpanId,
    name: raw.name,
    kind: raw.kind ?? 0,
    startNs: BigInt(raw.startTimeUnixNano),
    endNs: end === 0n ? null : end,
    attrs: decodeAttributes(raw.attributes),
    events: (raw.events ?? []).map((e) => ({ name: e.name, timeNs: BigInt(e.timeUnixNano), attrs: decodeAttributes(e.attributes) })),
    status: { code: raw.status?.code ?? 0, message: raw.status?.message },
    resourceKey,
    scopeKey,
    raw,
  };
}
