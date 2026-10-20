import type { ChatModel, Completion, CompletionRequest } from "../brains/types";
import type { ToolName } from "./protocol";

/** Faults the visitor can toggle. The runner applies them identically to every brain. */
export interface FaultConfig {
  /** The first run_tests call fails one test, chosen by the run's seed. */
  flakyTest?: boolean;
  /** The first call to this tool really blocks past its deadline. */
  toolTimeout?: ToolName;
  /** The model's second completion is truncated, exercising validation and retry. */
  malformedOutput?: boolean;
}

export const MALFORMED_AT_CALL = 2;

export function faultList(faults: FaultConfig): string[] {
  const out: string[] = [];
  if (faults.flakyTest) out.push("flaky_test");
  if (faults.toolTimeout) out.push(`tool_timeout:${faults.toolTimeout}`);
  if (faults.malformedOutput) out.push("malformed_output");
  return out;
}

/**
 * Wraps any ChatModel and truncates one completion's text, so the shared
 * validator and retry path really run. Usage the model reported is kept as is.
 */
export class MalformingModel implements ChatModel {
  private calls = 0;
  /** True when the most recent completion was corrupted. */
  lastWasCorrupted = false;

  constructor(private readonly inner: ChatModel, private readonly atCall = MALFORMED_AT_CALL) {}

  get id() {
    return this.inner.id;
  }
  get provider() {
    return this.inner.provider;
  }
  get label() {
    return this.inner.label;
  }

  async complete(request: CompletionRequest): Promise<Completion> {
    const completion = await this.inner.complete(request);
    this.calls += 1;
    this.lastWasCorrupted = this.calls === this.atCall;
    if (!this.lastWasCorrupted) return completion;
    return { ...completion, text: completion.text.slice(0, Math.max(1, Math.floor(completion.text.length / 2))) };
  }
}
