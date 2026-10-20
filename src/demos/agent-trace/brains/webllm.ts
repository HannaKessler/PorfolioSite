import type { WebWorkerMLCEngine, ChatCompletion, ChatCompletionMessageParam } from "@mlc-ai/web-llm";
import { TOOL_CALL_SCHEMA } from "../agent/protocol";
import type { ChatModel, Completion, CompletionRequest, Msg, ReportedUsage } from "./types";

export interface LoadProgress {
  text: string;
  /** 0–1, as reported by WebLLM. */
  progress: number;
}

type WebLLM = typeof import("@mlc-ai/web-llm");
let webllm: Promise<WebLLM> | undefined;
/** WebLLM is a separate chunk, fetched only when the visitor opts in. */
export const loadWebLLM = (): Promise<WebLLM> => (webllm ??= import("@mlc-ai/web-llm"));

/**
 * Maps WebLLM's reported usage field by field. A field that the runtime did not
 * report stays absent; nothing is defaulted or estimated.
 */
export function mapReportedUsage(usage: ChatCompletion["usage"] | undefined): ReportedUsage | undefined {
  if (!usage) return undefined;
  const out: ReportedUsage = {};
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const set = <K extends keyof ReportedUsage>(k: K, v: unknown) => {
    const n = num(v);
    if (n !== undefined) out[k] = n;
  };
  set("inputTokens", usage.prompt_tokens);
  set("outputTokens", usage.completion_tokens);
  const extra = (usage as { extra?: Record<string, unknown> }).extra;
  if (extra) {
    set("timeToFirstTokenS", extra.time_to_first_token_s);
    set("timePerOutputTokenS", extra.time_per_output_token_s);
    set("prefillTokensPerS", extra.prefill_tokens_per_s);
    set("decodeTokensPerS", extra.decode_tokens_per_s);
    set("e2eLatencyS", extra.e2e_latency_s);
    set("grammarInitS", extra.grammar_init_s);
  }
  return Object.keys(out).length ? out : undefined;
}

/** WebLLM has no tool role for these models, so tool results are sent as user turns. */
export function toWebLLMMessages(messages: Msg[]): ChatCompletionMessageParam[] {
  return messages.map((m) =>
    m.role === "tool"
      ? { role: "user", content: `Tool result for ${m.toolName} (${m.toolCallId}):\n${m.content}` }
      : { role: m.role, content: m.content },
  ) as ChatCompletionMessageParam[];
}

export interface EngineLike {
  resetChat(keepStats?: boolean): Promise<void>;
  interruptGenerate(): void;
  chat: { completions: { create(request: Record<string, unknown>): Promise<unknown> } };
}

/** A real model running in the browser through WebLLM. */
export class WebLLMBrain implements ChatModel {
  readonly provider = "webllm";
  constructor(readonly id: string, readonly label: string, private readonly engine: EngineLike) {}

  static async create(modelId: string, label: string, onProgress: (p: LoadProgress) => void): Promise<WebLLMBrain> {
    const { CreateWebWorkerMLCEngine } = await loadWebLLM();
    const worker = new Worker(new URL("./webllm.worker.ts", import.meta.url), { type: "module" });
    const engine: WebWorkerMLCEngine = await CreateWebWorkerMLCEngine(worker, modelId, {
      initProgressCallback: (r) => onProgress({ text: r.text, progress: r.progress }),
    });
    return new WebLLMBrain(modelId, label, engine as unknown as EngineLike);
  }

  async complete(request: CompletionRequest): Promise<Completion> {
    if (request.signal.aborted) throw request.signal.reason;
    // Start each request from a fresh conversation so WebLLM counts and prefills the
    // full prompt (with multi-round reuse it reports only the new part of the prompt).
    await this.engine.resetChat();
    const onAbort = () => this.engine.interruptGenerate();
    request.signal.addEventListener("abort", onAbort, { once: true });
    const body = {
      messages: toWebLLMMessages(request.messages),
      stream: false,
      temperature: 0,
      max_tokens: 512,
      response_format: { type: "json_object", schema: JSON.stringify(TOOL_CALL_SCHEMA) },
    };
    try {
      const reply = (await this.engine.chat.completions.create(body)) as ChatCompletion;
      if (request.signal.aborted) throw request.signal.reason;
      const choice = reply.choices[0];
      return {
        text: choice?.message?.content ?? "",
        finishReason: choice?.finish_reason ?? "stop",
        usage: mapReportedUsage(reply.usage),
        request: JSON.stringify(body),
      };
    } finally {
      request.signal.removeEventListener("abort", onAbort);
    }
  }
}

export async function isModelCached(modelId: string): Promise<boolean> {
  const { hasModelInCache } = await loadWebLLM();
  return hasModelInCache(modelId);
}

export async function removeModel(modelId: string): Promise<void> {
  const { deleteModelAllInfoInCache } = await loadWebLLM();
  await deleteModelAllInfoInCache(modelId);
}
