import type { ChatModel, Completion, CompletionRequest, Msg } from "./types";
import { FORMAT_DURATION_FIXES } from "./scripts/format-duration";

export const SCRIPTED_MODEL_ID = "scripted-v1";

interface ToolResult {
  name: string;
  value: Record<string, unknown>;
}

function lastToolResult(messages: Msg[]): ToolResult | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "tool" && m.toolName) {
      try {
        return { name: m.toolName, value: JSON.parse(m.content) };
      } catch {
        return { name: m.toolName, value: {} };
      }
    }
  }
  return undefined;
}

/** "formatDuration > pads single-digit seconds" → "src/formatDuration.js". */
function moduleFromFailure(failures: unknown): string | undefined {
  const first = Array.isArray(failures) ? (failures[0] as { name?: string } | undefined) : undefined;
  const suite = first?.name?.split(" > ")[0];
  return suite ? `src/${suite}.js` : undefined;
}

/** The `replace` strings of edit_file calls this brain made earlier in the run. */
function appliedReplacements(messages: Msg[]): string[] {
  const out: string[] = [];
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    try {
      const parsed = JSON.parse(m.content);
      if (parsed?.tool === "edit_file" && typeof parsed.args?.replace === "string") out.push(parsed.args.replace);
    } catch {
      // Not JSON (for example, a corrupted reply); ignore.
    }
  }
  return out;
}

const call = (thought: string, tool: string, args: Record<string, string> = {}) => JSON.stringify({ thought, tool, args });

/**
 * A deterministic rule set over the conversation history. It returns raw text
 * like a model would, so its replies go through the same parser, validator and
 * retry path. It reports no usage: no tokens, no runtime statistics, and it adds
 * no artificial latency.
 */
export function decide(messages: Msg[]): string {
  const last = lastToolResult(messages);
  if (!last) return call("Run the tests to see what fails.", "run_tests");
  const v = last.value;
  switch (last.name) {
    case "run_tests": {
      if (typeof v.error === "string" && /did not finish/.test(v.error)) return call("The test run timed out; run it again.", "run_tests");
      if (v.failed === 0 && !v.error) {
        const fix = FORMAT_DURATION_FIXES.find((f) => appliedReplacements(messages).includes(f.replace));
        return call("All tests pass.", "finish", { summary: fix?.summary ?? "All tests pass without changes." });
      }
      const path = moduleFromFailure(v.failures) ?? "src/formatDuration.js";
      return call(`Read ${path}, the module the failing tests cover.`, "read_file", { path });
    }
    case "read_file": {
      if (typeof v.contents !== "string") return call("Run the tests again to find the module.", "run_tests");
      const fix = FORMAT_DURATION_FIXES.find((f) => (v.contents as string).includes(f.find));
      if (!fix) return call("The tests fail but no known bug pattern is present; re-run the tests.", "run_tests");
      return call("Replace the buggy line with the corrected one.", "edit_file", { path: String(v.path), find: fix.find, replace: fix.replace });
    }
    case "edit_file":
      if (v.ok) return call("Re-run the tests to confirm the fix.", "run_tests");
      return call("The edit did not apply; read the file again.", "read_file", { path: "src/formatDuration.js" });
    default:
      return call("Run the tests.", "run_tests");
  }
}

export class ScriptedBrain implements ChatModel {
  readonly id = SCRIPTED_MODEL_ID;
  readonly provider = "simulated";
  readonly label = "Simulated brain";

  async complete(request: CompletionRequest): Promise<Completion> {
    if (request.signal.aborted) throw request.signal.reason;
    // No usage field: the scripted brain has no tokens or runtime statistics to report.
    return { text: decide(request.messages), finishReason: "stop" };
  }
}
