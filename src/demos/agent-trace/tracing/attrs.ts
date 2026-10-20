/**
 * Attribute names used on every span. GenAI names follow the OpenTelemetry GenAI
 * semantic conventions (Development status, so they are pinned here in one place).
 * `app.*` names are this demo's own.
 */
export const GEN_AI = {
  operationName: "gen_ai.operation.name",
  agentName: "gen_ai.agent.name",
  conversationId: "gen_ai.conversation.id",
  providerName: "gen_ai.provider.name",
  requestModel: "gen_ai.request.model",
  responseFinishReasons: "gen_ai.response.finish_reasons",
  inputMessages: "gen_ai.input.messages",
  outputMessages: "gen_ai.output.messages",
  usageInputTokens: "gen_ai.usage.input_tokens",
  usageOutputTokens: "gen_ai.usage.output_tokens",
  toolName: "gen_ai.tool.name",
  toolCallId: "gen_ai.tool.call.id",
  toolType: "gen_ai.tool.type",
  toolCallArguments: "gen_ai.tool.call.arguments",
  toolCallResult: "gen_ai.tool.call.result",
} as const;

export const ERROR_TYPE = "error.type";

export const APP = {
  spanType: "app.span.type",
  taskId: "app.task.id",
  taskVariant: "app.task.variant",
  brainLabel: "app.brain.label",
  maxSteps: "app.run.max_steps",
  seed: "app.run.seed",
  faults: "app.run.faults",
  stepMode: "app.run.step_mode",
  runOutcome: "app.run.outcome",
  stepIndex: "app.step.index",
  stepOutcome: "app.step.outcome",
  attempt: "app.attempt",
  faultInjected: "app.fault.injected",
  truncated: "app.truncated",
  pauseReason: "app.pause.reason",
  testsPassed: "app.test.passed",
  testsFailed: "app.test.failed",
  toolDeadlineMs: "app.tool.deadline_ms",
  // The virtual project: every file at the start of the run (JSON object of path → contents).
  vfsFiles: "app.vfs.files",
  // edit_file: the file as it was before the call, as it is after (only when the edit applied),
  // and how many times `find` occurred in it.
  filePath: "app.file.path",
  fileBefore: "app.file.before",
  fileAfter: "app.file.after",
  editMatches: "app.edit.matches",
  // The scripted brain's decision: which rule fired and the condition it matched.
  policyRule: "app.policy.rule",
  policyCondition: "app.policy.condition",
  // The exact request body a model runtime received (WebLLM), as JSON.
  llmRequest: "app.llm.request",
  // Runtime statistics reported by WebLLM in usage.extra. Only set when reported.
  llmTimeToFirstTokenS: "app.llm.time_to_first_token_s",
  llmTimePerOutputTokenS: "app.llm.time_per_output_token_s",
  llmPrefillTokensPerS: "app.llm.prefill_tokens_per_s",
  llmDecodeTokensPerS: "app.llm.decode_tokens_per_s",
  llmE2eLatencyS: "app.llm.e2e_latency_s",
  llmGrammarInitS: "app.llm.grammar_init_s",
} as const;

export const SPAN_TYPES = ["invoke_agent", "step", "chat", "execute_tool", "pause"] as const;
export type SpanType = (typeof SPAN_TYPES)[number];

export const ERROR_TYPES = ["timeout", "malformed_output", "tool_error", "test_failure", "aborted", "step_cap"] as const;
export type ErrorType = (typeof ERROR_TYPES)[number];

export const EVENT_NAMES = ["retry", "validation_error"] as const;

export const FAULT_TYPES = ["flaky_test", "tool_timeout", "malformed_output"] as const;
export type FaultType = (typeof FAULT_TYPES)[number];

/**
 * Maximum recorded size of a message, tool or file payload, in characters. Large
 * enough for a full prompt at the default step cap, so prompts are recorded whole.
 */
export const PAYLOAD_LIMIT = 64 * 1024;

/**
 * Usage and runtime statistics exactly as a model runtime reported them.
 * Every field is optional and nothing is ever filled in or estimated.
 */
export interface ReportedUsage {
  inputTokens?: number;
  outputTokens?: number;
  timeToFirstTokenS?: number;
  timePerOutputTokenS?: number;
  prefillTokensPerS?: number;
  decodeTokensPerS?: number;
  e2eLatencyS?: number;
  grammarInitS?: number;
}

const USAGE_KEYS: [keyof ReportedUsage, string][] = [
  ["inputTokens", GEN_AI.usageInputTokens],
  ["outputTokens", GEN_AI.usageOutputTokens],
  ["timeToFirstTokenS", APP.llmTimeToFirstTokenS],
  ["timePerOutputTokenS", APP.llmTimePerOutputTokenS],
  ["prefillTokensPerS", APP.llmPrefillTokensPerS],
  ["decodeTokensPerS", APP.llmDecodeTokensPerS],
  ["e2eLatencyS", APP.llmE2eLatencyS],
  ["grammarInitS", APP.llmGrammarInitS],
];

/** Attribute keys that exist only when a runtime reported them. */
export const REPORTED_ONLY_KEYS: readonly string[] = USAGE_KEYS.map(([, k]) => k);

/** Attribute keys a brain adds about itself: present for one brain, absent for the other. */
export const BRAIN_REPORTED_KEYS: readonly string[] = [APP.policyRule, APP.policyCondition, APP.llmRequest];

/** Copies reported fields to attributes. Missing or non-finite fields stay absent. */
export function usageToAttributes(usage: ReportedUsage | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (!usage) return out;
  for (const [field, key] of USAGE_KEYS) {
    const v = usage[field];
    if (typeof v === "number" && Number.isFinite(v)) out[key] = v;
  }
  return out;
}

/** Caps a payload at PAYLOAD_LIMIT characters. */
export function capPayload(text: string): { text: string; truncated: boolean } {
  return text.length > PAYLOAD_LIMIT ? { text: text.slice(0, PAYLOAD_LIMIT), truncated: true } : { text, truncated: false };
}
