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

export interface Completion {
  /** Raw model text. It must contain a JSON tool call; the loop parses and validates it. */
  text: string;
  finishReason: string;
  /** Only what the runtime itself reported. Absent for the scripted brain. */
  usage?: ReportedUsage;
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
