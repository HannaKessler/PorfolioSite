import {
  SpanFormatError,
  normalizeKeyValues,
  normalizeSpan,
  toNormSpan,
  type NormSpan,
  type OtlpExportRequest,
  type OtlpResource,
  type OtlpScope,
} from "./normalize";

export class IngestError extends Error {}

export interface ParsedBatch {
  spans: NormSpan[];
  resources: Map<string, { resource: OtlpResource; schemaUrl?: string }>;
  scopes: Map<string, { scope: OtlpScope; schemaUrl?: string }>;
  rejected: { index: number; reason: string }[];
}

/** Validates and normalizes one ExportTraceServiceRequest (object or JSON text). */
export function parseOtlp(input: unknown): ParsedBatch {
  let doc: unknown = input;
  if (typeof input === "string") {
    try {
      doc = JSON.parse(input);
    } catch (e) {
      throw new IngestError(`Not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (!doc || typeof doc !== "object" || !Array.isArray((doc as OtlpExportRequest).resourceSpans)) {
    throw new IngestError("Not an OTLP-JSON trace export: expected a top-level resourceSpans array");
  }
  const out: ParsedBatch = { spans: [], resources: new Map(), scopes: new Map(), rejected: [] };
  let index = 0;
  for (const rs of (doc as OtlpExportRequest).resourceSpans) {
    const resource: OtlpResource = {
      attributes: normalizeKeyValues(rs?.resource?.attributes),
      droppedAttributesCount: rs?.resource?.droppedAttributesCount ?? 0,
    };
    const resourceKey = JSON.stringify([resource, rs?.schemaUrl ?? ""]);
    out.resources.set(resourceKey, { resource, ...(rs?.schemaUrl ? { schemaUrl: rs.schemaUrl } : {}) });
    for (const ss of rs?.scopeSpans ?? []) {
      const scope: OtlpScope = {
        name: ss?.scope?.name ?? "",
        ...(ss?.scope?.version ? { version: ss.scope.version } : {}),
        attributes: normalizeKeyValues(ss?.scope?.attributes),
        droppedAttributesCount: ss?.scope?.droppedAttributesCount ?? 0,
      };
      const scopeKey = JSON.stringify([resourceKey, scope, ss?.schemaUrl ?? ""]);
      out.scopes.set(scopeKey, { scope, ...(ss?.schemaUrl ? { schemaUrl: ss.schemaUrl } : {}) });
      for (const span of ss?.spans ?? []) {
        try {
          out.spans.push(toNormSpan(normalizeSpan(span), resourceKey, scopeKey));
        } catch (e) {
          if (!(e instanceof SpanFormatError)) throw e;
          out.rejected.push({ index, reason: e.message });
        }
        index++;
      }
    }
  }
  return out;
}
