import { ROOT_CONTEXT, SpanKind, SpanStatusCode, trace, type Attributes, type Span, type Tracer } from "@opentelemetry/api";
import type { ChatModel, Msg } from "../brains/types";
import { APP, ERROR_TYPE, GEN_AI, capPayload, usageToAttributes, type ErrorType } from "../tracing/attrs";
import { toHrTime, type Clock } from "../tracing/clock";
import type { TestRunner } from "../testrunner/protocol";
import type { TestRunResult } from "../testrunner/mini-expect";
import { MalformingModel, faultList, type FaultConfig } from "./faults";
import { TOOL_CALL_SCHEMA, parseToolCall, type ToolCall, type ToolName } from "./protocol";
import { seededRandom } from "./rng";
import { DEFAULT_DEADLINES_MS, TOOL_DEFS, executeTool, type ToolOutcome } from "./tools";
import { Vfs } from "./vfs";

export const AGENT_NAME = "trace-fixer";
export const DEFAULT_MAX_STEPS = 12;
/** A malformed or invalid tool call gets this many retries before the step fails. */
export const MAX_RETRIES = 2;

export interface AgentTask {
  id: string;
  variant: string;
  text: string;
  files: Record<string, string>;
}

export interface RunConfig {
  runId: string;
  seed: number;
  maxSteps: number;
  faults: FaultConfig;
  stepMode: boolean;
}

export interface AgentDeps {
  model: ChatModel;
  tracer: Tracer;
  clock: Clock;
  testRunner: TestRunner;
  signal: AbortSignal;
  /** Step mode: resolves when the visitor allows the next step. */
  stepGate?: (step: number) => Promise<void>;
  deadlines?: Partial<Record<ToolName, number>>;
}

export type RunOutcome = "finished" | "step_cap" | "aborted";

export interface RunResult {
  outcome: RunOutcome;
  steps: number;
  lastTests?: TestRunResult;
  files: Record<string, string>;
  summary?: string;
}

export function systemPrompt(): string {
  const tools = TOOL_DEFS.map((t) => `- ${t.name}: ${t.description} Args: ${JSON.stringify(t.parameters)}`).join("\n");
  return [
    "You are a careful software agent working in a small JavaScript project.",
    "Reply with exactly one JSON object and nothing else, in this shape:",
    '{"thought": "<one short sentence>", "tool": "<tool name>", "args": { ... }}',
    "Tools:",
    tools,
    "Work one tool call at a time. Run the tests first, read the failing module, make the smallest edit that fixes it, run the tests again, and call finish when they all pass.",
    `Reply schema: ${JSON.stringify(TOOL_CALL_SCHEMA)}`,
  ].join("\n");
}

/** gen_ai.*.messages format: role plus typed parts. */
function toSemconvMessages(messages: Msg[]): unknown[] {
  return messages.map((m) =>
    m.role === "tool"
      ? { role: "tool", parts: [{ type: "tool_call_response", id: m.toolCallId, response: m.content }] }
      : { role: m.role, parts: [{ type: "text", content: m.content }] },
  );
}

class Spans {
  constructor(private tracer: Tracer, private clock: Clock) {}

  start(name: string, kind: SpanKind, attributes: Attributes, parent?: Span): Span {
    const ctx = parent ? trace.setSpan(ROOT_CONTEXT, parent) : ROOT_CONTEXT;
    return this.tracer.startSpan(name, { kind, attributes, startTime: toHrTime(this.clock()) }, ctx);
  }

  event(span: Span, name: string, attributes: Attributes) {
    span.addEvent(name, attributes, toHrTime(this.clock()));
  }

  fail(span: Span, type: ErrorType, message: string) {
    span.setAttribute(ERROR_TYPE, type);
    span.setStatus({ code: SpanStatusCode.ERROR, message });
  }

  end(span: Span) {
    span.end(toHrTime(this.clock()));
  }
}

function payload(span: Span, key: string, value: string): void {
  span.setAttributes(payloadAttrs(key, value));
}

/** A capped payload as start attributes, so the open copy of a span already carries it. */
function payloadAttrs(key: string, value: string): Attributes {
  const capped = capPayload(value);
  return capped.truncated ? { [key]: capped.text, [APP.truncated]: true } : { [key]: capped.text };
}

const isAbort = (signal: AbortSignal) => signal.aborted;

/**
 * The agent loop. Brain-agnostic: everything after `model.complete()` (parsing,
 * validation, retries, tools, tracing) is shared by every brain.
 */
export async function runAgent(task: AgentTask, config: RunConfig, deps: AgentDeps): Promise<RunResult> {
  const spans = new Spans(deps.tracer, deps.clock);
  const vfs = new Vfs(task.files);
  const rng = seededRandom(config.seed);
  const model = config.faults.malformedOutput ? new MalformingModel(deps.model) : deps.model;
  const deadlines = { ...DEFAULT_DEADLINES_MS, ...deps.deadlines };
  const faultsUsed = { flaky: false, timeout: false };

  const root = spans.start(`invoke_agent ${AGENT_NAME}`, SpanKind.INTERNAL, {
    [APP.spanType]: "invoke_agent",
    [GEN_AI.operationName]: "invoke_agent",
    [GEN_AI.agentName]: AGENT_NAME,
    [GEN_AI.conversationId]: config.runId,
    [GEN_AI.providerName]: model.provider,
    [GEN_AI.requestModel]: model.id,
    [APP.brainLabel]: model.label,
    [APP.taskId]: task.id,
    [APP.taskVariant]: task.variant,
    [APP.maxSteps]: config.maxSteps,
    [APP.seed]: config.seed,
    [APP.faults]: faultList(config.faults),
    [APP.stepMode]: config.stepMode,
    ...payloadAttrs(APP.vfsFiles, JSON.stringify(vfs.snapshot())),
  });

  const messages: Msg[] = [
    { role: "system", content: systemPrompt() },
    { role: "user", content: task.text },
  ];
  let outcome: RunOutcome = "step_cap";
  let lastTests: TestRunResult | undefined;
  let summary: string | undefined;
  let step = 0;

  try {
    while (step < config.maxSteps) {
      if (isAbort(deps.signal)) {
        outcome = "aborted";
        break;
      }
      step += 1;
      if (deps.stepGate) {
        const pause = spans.start("pause", SpanKind.INTERNAL, { [APP.spanType]: "pause", [APP.pauseReason]: "user_step", [APP.stepIndex]: step }, root);
        try {
          await deps.stepGate(step);
        } finally {
          spans.end(pause);
        }
        if (isAbort(deps.signal)) {
          outcome = "aborted";
          break;
        }
      }

      const stepSpan = spans.start(`step ${step}`, SpanKind.INTERNAL, { [APP.spanType]: "step", [APP.stepIndex]: step }, root);
      try {
        // 1. Ask the model, with up to MAX_RETRIES retries for invalid tool calls.
        let call: ToolCall | undefined;
        for (let attempt = 1; attempt <= 1 + MAX_RETRIES && !call; attempt++) {
          const chat = spans.start(`chat ${model.id}`, SpanKind.CLIENT, {
            [APP.spanType]: "chat",
            [GEN_AI.operationName]: "chat",
            [GEN_AI.providerName]: model.provider,
            [GEN_AI.requestModel]: model.id,
            [APP.stepIndex]: step,
            [APP.attempt]: attempt,
            ...payloadAttrs(GEN_AI.inputMessages, JSON.stringify(toSemconvMessages(messages))),
          }, stepSpan);
          try {
            if (attempt > 1) spans.event(chat, "retry", { [APP.attempt]: attempt });
            const completion = await model.complete({ messages: [...messages], tools: TOOL_DEFS, signal: deps.signal });
            chat.setAttributes(usageToAttributes(completion.usage));
            if (completion.decision) {
              chat.setAttribute(APP.policyRule, completion.decision.rule);
              chat.setAttribute(APP.policyCondition, completion.decision.condition);
            }
            if (completion.request !== undefined) payload(chat, APP.llmRequest, completion.request);
            chat.setAttribute(GEN_AI.responseFinishReasons, [completion.finishReason]);
            payload(chat, GEN_AI.outputMessages, JSON.stringify([
              { role: "assistant", parts: [{ type: "text", content: completion.text }], finish_reason: completion.finishReason },
            ]));
            if (model instanceof MalformingModel && model.lastWasCorrupted) chat.setAttribute(APP.faultInjected, "malformed_output");
            const parsed = parseToolCall(completion.text);
            messages.push({ role: "assistant", content: completion.text });
            if (parsed.ok) {
              call = parsed.call;
            } else {
              spans.event(chat, "validation_error", { "exception.message": parsed.error, [APP.attempt]: attempt });
              spans.fail(chat, "malformed_output", parsed.error);
              messages.push({
                role: "user",
                content: `Your reply was not a valid tool call: ${parsed.error}. Reply with only one JSON object in the required shape.`,
              });
            }
          } finally {
            spans.end(chat);
          }
        }
        if (!call) {
          stepSpan.setAttribute(APP.stepOutcome, "invalid_output");
          spans.fail(stepSpan, "malformed_output", `No valid tool call after ${1 + MAX_RETRIES} attempts`);
          continue;
        }

        // 2. Execute the tool; a timeout is retried once.
        const callId = `call_${step}`;
        let toolOutcome: ToolOutcome | undefined;
        for (let attempt = 1; attempt <= 2; attempt++) {
          const tool = spans.start(`execute_tool ${call.tool}`, SpanKind.INTERNAL, {
            [APP.spanType]: "execute_tool",
            [GEN_AI.operationName]: "execute_tool",
            [GEN_AI.toolName]: call.tool,
            [GEN_AI.toolCallId]: callId,
            [GEN_AI.toolType]: "function",
            [APP.stepIndex]: step,
            [APP.attempt]: attempt,
            [APP.toolDeadlineMs]: deadlines[call.tool],
            ...payloadAttrs(GEN_AI.toolCallArguments, JSON.stringify(call.args)),
          }, stepSpan);
          try {
            if (attempt > 1) spans.event(tool, "retry", { [APP.attempt]: attempt });
            const fault: { hang?: boolean; forceFailPick?: number } = {};
            if (config.faults.toolTimeout === call.tool && !faultsUsed.timeout) {
              faultsUsed.timeout = true;
              fault.hang = true;
              tool.setAttribute(APP.faultInjected, "tool_timeout");
            }
            if (call.tool === "run_tests" && config.faults.flakyTest && !faultsUsed.flaky) {
              faultsUsed.flaky = true;
              fault.forceFailPick = rng();
              tool.setAttribute(APP.faultInjected, "flaky_test");
            }
            toolOutcome = await executeTool(call.tool, call.args, {
              vfs,
              testRunner: deps.testRunner,
              deadlineMs: deadlines[call.tool],
              signal: deps.signal,
              fault,
            });
            payload(tool, GEN_AI.toolCallResult, JSON.stringify(toolOutcome.result));
            if (toolOutcome.file) {
              tool.setAttribute(APP.filePath, toolOutcome.file.path);
              if (toolOutcome.file.before !== undefined) payload(tool, APP.fileBefore, toolOutcome.file.before);
              if (toolOutcome.file.after !== undefined) payload(tool, APP.fileAfter, toolOutcome.file.after);
              if (toolOutcome.file.matches !== undefined) tool.setAttribute(APP.editMatches, toolOutcome.file.matches);
            }
            if (toolOutcome.tests) {
              lastTests = toolOutcome.tests;
              tool.setAttribute(APP.testsPassed, toolOutcome.tests.passed);
              tool.setAttribute(APP.testsFailed, toolOutcome.tests.failed);
            }
            if (toolOutcome.errorType) spans.fail(tool, toolOutcome.errorType, toolOutcome.errorMessage ?? toolOutcome.errorType);
          } finally {
            spans.end(tool);
          }
          if (toolOutcome.errorType !== "timeout" || isAbort(deps.signal)) break;
        }
        const result = toolOutcome!;
        messages.push({ role: "tool", toolName: call.tool, toolCallId: callId, content: JSON.stringify(result.result) });
        stepSpan.setAttribute(APP.stepOutcome, result.finished ? "finished" : result.errorType ?? "ok");
        if (result.errorType === "timeout" || result.errorType === "tool_error") {
          spans.fail(stepSpan, result.errorType, result.errorMessage ?? result.errorType);
        }
        if (result.finished) {
          outcome = "finished";
          summary = call.args.summary;
          break;
        }
      } finally {
        spans.end(stepSpan);
      }
    }
  } catch (e) {
    if (isAbort(deps.signal)) {
      outcome = "aborted";
    } else {
      root.recordException(e instanceof Error ? e : String(e), toHrTime(deps.clock()));
      root.setStatus({ code: SpanStatusCode.ERROR, message: e instanceof Error ? e.message : String(e) });
      root.setAttribute(APP.runOutcome, "error");
      spans.end(root);
      throw e;
    }
  }

  root.setAttribute(APP.runOutcome, outcome);
  if (lastTests) {
    root.setAttribute(APP.testsPassed, lastTests.passed);
    root.setAttribute(APP.testsFailed, lastTests.failed);
  }
  if (outcome === "aborted") spans.fail(root, "aborted", "Run stopped by the visitor");
  if (outcome === "step_cap") spans.fail(root, "step_cap", `Stopped after ${config.maxSteps} steps without finishing`);
  spans.end(root);
  return { outcome, steps: step, lastTests, files: vfs.snapshot(), summary };
}
