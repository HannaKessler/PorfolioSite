import type { NormSpan } from "../collector/normalize";
import { APP, BRAIN_REPORTED_KEYS, ERROR_TYPE, ERROR_TYPES, EVENT_NAMES, GEN_AI, REPORTED_ONLY_KEYS, type SpanType } from "./attrs";

/**
 * The span schema shared by every brain: names, kinds, required and optional
 * attribute keys, and events per span type. Reported-only keys (token counts,
 * runtime stats) may be present or absent but never replaced by anything else.
 */
interface SpanRule {
  name: RegExp;
  /** OTLP kind: 1 internal, 3 client. */
  kind: number;
  parent: SpanType | null;
  required: string[];
  optional: string[];
  events: string[];
}

const COMMON_OPTIONAL = [ERROR_TYPE, APP.faultInjected, APP.truncated];

export const SPAN_SCHEMA: Record<SpanType, SpanRule> = {
  invoke_agent: {
    name: /^invoke_agent \S+$/,
    kind: 1,
    parent: null,
    required: [
      APP.spanType, GEN_AI.operationName, GEN_AI.agentName, GEN_AI.conversationId, GEN_AI.providerName, GEN_AI.requestModel,
      APP.brainLabel, APP.taskId, APP.taskVariant, APP.maxSteps, APP.seed, APP.faults, APP.stepMode, APP.runOutcome, APP.vfsFiles,
    ],
    optional: [...COMMON_OPTIONAL, APP.testsPassed, APP.testsFailed],
    events: ["exception"],
  },
  pause: { name: /^pause$/, kind: 1, parent: "invoke_agent", required: [APP.spanType, APP.pauseReason, APP.stepIndex], optional: [], events: [] },
  step: { name: /^step \d+$/, kind: 1, parent: "invoke_agent", required: [APP.spanType, APP.stepIndex], optional: [...COMMON_OPTIONAL, APP.stepOutcome], events: [] },
  chat: {
    name: /^chat \S+$/,
    kind: 3,
    parent: "step",
    required: [APP.spanType, GEN_AI.operationName, GEN_AI.providerName, GEN_AI.requestModel, APP.stepIndex, APP.attempt, GEN_AI.inputMessages],
    // Response attributes are absent only if the request was aborted.
    optional: [...COMMON_OPTIONAL, GEN_AI.responseFinishReasons, GEN_AI.outputMessages, ...REPORTED_ONLY_KEYS, ...BRAIN_REPORTED_KEYS],
    events: [...EVENT_NAMES],
  },
  execute_tool: {
    name: /^execute_tool (read_file|edit_file|run_tests|finish)$/,
    kind: 1,
    parent: "step",
    required: [
      APP.spanType, GEN_AI.operationName, GEN_AI.toolName, GEN_AI.toolCallId, GEN_AI.toolType, APP.stepIndex, APP.attempt,
      APP.toolDeadlineMs, GEN_AI.toolCallArguments,
    ],
    optional: [...COMMON_OPTIONAL, GEN_AI.toolCallResult, APP.testsPassed, APP.testsFailed, APP.filePath, APP.fileBefore, APP.fileAfter, APP.editMatches],
    events: ["retry"],
  },
};

export function spanType(span: Pick<NormSpan, "attrs">): SpanType | undefined {
  const t = span.attrs[APP.spanType];
  return typeof t === "string" && t in SPAN_SCHEMA ? (t as SpanType) : undefined;
}

/** Returns human-readable schema violations for a run's spans (empty when valid). */
export function validateSpans(spans: NormSpan[]): string[] {
  const errors: string[] = [];
  const byId = new Map(spans.map((s) => [s.spanId, s]));
  for (const s of spans) {
    const type = spanType(s);
    if (!type) {
      errors.push(`${s.name}: unknown span type`);
      continue;
    }
    const rule = SPAN_SCHEMA[type];
    if (!rule.name.test(s.name)) errors.push(`${s.name}: name does not match ${rule.name}`);
    if (s.kind !== rule.kind) errors.push(`${s.name}: kind ${s.kind}, expected ${rule.kind}`);
    const parent = s.parentSpanId ? byId.get(s.parentSpanId) : undefined;
    const parentType = parent ? spanType(parent) : null;
    if ((parentType ?? null) !== rule.parent) errors.push(`${s.name}: parent ${parentType}, expected ${rule.parent}`);
    for (const k of rule.required) if (!(k in s.attrs)) errors.push(`${s.name}: missing ${k}`);
    const allowed = new Set([...rule.required, ...rule.optional]);
    for (const k of Object.keys(s.attrs)) if (!allowed.has(k)) errors.push(`${s.name}: unexpected attribute ${k}`);
    for (const e of s.events) if (!rule.events.includes(e.name)) errors.push(`${s.name}: unexpected event ${e.name}`);
    const et = s.attrs[ERROR_TYPE];
    if (et !== undefined && !(ERROR_TYPES as readonly unknown[]).includes(et)) errors.push(`${s.name}: unknown error.type ${String(et)}`);
    if (s.status.code === 2 && et === undefined) errors.push(`${s.name}: ERROR status without error.type`);
  }
  return errors;
}

/** Attribute keys per span type, excluding keys that exist only when a runtime or brain reports them. */
export function structuralKeys(spans: NormSpan[]): Record<string, string[]> {
  const out: Record<string, Set<string>> = {};
  for (const s of spans) {
    const type = spanType(s) ?? "unknown";
    out[type] ??= new Set();
    for (const k of Object.keys(s.attrs)) if (!REPORTED_ONLY_KEYS.includes(k) && !BRAIN_REPORTED_KEYS.includes(k)) out[type].add(k);
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [...v].sort()]));
}
