import type { ReportedUsage } from "../tracing/attrs";

export type { ReportedUsage };

export type Role = "system" | "user" | "assistant" | "tool";

export interface Msg {
  role: Role;
  content: string;
  /** Set on tool results. */
  toolName?: string;
  toolCallId?: string;
}

export interface ToolDef {
  name: string;
  description: string;
  /** JSON Schema of the args object. */
  parameters: Record<string, unknown>;
}

export interface CompletionRequest {
  messages: Msg[];
  tools: ToolDef[];
  signal: AbortSignal;
}

/** What the scripted policy decided and why: the rule that fired and the condition it matched. */
export interface PolicyDecision {
  rule: string;
  condition: string;
}

export interface Completion {
  /** Raw model text. It must contain a JSON tool call; the loop parses and validates it. */
  text: string;
  finishReason: string;
  /** Only what the runtime itself reported. Absent for the scripted brain. */
  usage?: ReportedUsage;
  /** Set by the scripted brain only: the rule behind this reply. */
  decision?: PolicyDecision;
  /** Set by brains backed by a runtime: the exact request body it received, as JSON. */
  request?: string;
}

export interface ChatModel {
  /** e.g. "scripted-v1" or "Qwen2.5-1.5B-Instruct-q4f16_1-MLC"; becomes gen_ai.request.model. */
  readonly id: string;
  /** "simulated" or "webllm"; becomes gen_ai.provider.name. */
  readonly provider: string;
  /** Human-readable name shown in the UI. */
  readonly label: string;
  complete(request: CompletionRequest): Promise<Completion>;
}
