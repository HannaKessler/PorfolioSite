import type { ChatModel, Completion, CompletionRequest } from "../../src/demos/agent-trace/brains/types";
import { mapReportedUsage } from "../../src/demos/agent-trace/brains/webllm";

/** One recorded WebLLM chat.completions response (the parts the brain reads). */
export interface RecordedResponse {
  content: string;
  finish_reason: string;
  usage?: Record<string, unknown>;
}

/**
 * Replays recorded completions as text through the same loop, with usage mapped
 * by the real WebLLM mapping, standing in for the GPU in tests.
 */
export class ReplayModel implements ChatModel {
  readonly provider = "webllm";
  readonly label = "Replay of a WebLLM run";
  private i = 0;
  constructor(readonly id: string, private readonly responses: RecordedResponse[]) {}

  async complete(request: CompletionRequest): Promise<Completion> {
    if (request.signal.aborted) throw request.signal.reason;
    const r = this.responses[Math.min(this.i++, this.responses.length - 1)];
    return { text: r.content, finishReason: r.finish_reason, usage: mapReportedUsage(r.usage as never) };
  }
}
