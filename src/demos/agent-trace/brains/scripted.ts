import type { ChatModel, Completion, CompletionRequest, Msg, PolicyDecision } from "./types";
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

export interface ScriptedReply {
  text: string;
  decision: PolicyDecision;
}

const reply = (rule: string, condition: string, tool: string, args: Record<string, string> = {}): ScriptedReply => ({
  text: JSON.stringify({ tool, args }),
  decision: { rule, condition },
});

const quote = (v: unknown) => JSON.stringify(v);

/**
 * A deterministic rule set over the conversation history. It returns raw text
 * like a model would, so its replies go through the same parser, validator and
 * retry path. Alongside the text it reports which rule fired and the values it
 * matched; it writes no reasoning of its own. It reports no usage (no tokens or
 * runtime statistics) and adds no artificial latency.
 */
export function decide(messages: Msg[]): ScriptedReply {
  const last = lastToolResult(messages);
  if (!last) return reply("no tool result yet → run_tests", "The conversation has no tool result yet.", "run_tests");
  const v = last.value;
  switch (last.name) {
    case "run_tests": {
      if (typeof v.error === "string" && /did not finish/.test(v.error)) {
        return reply("run_tests timed out → run_tests again", `Last result: run_tests error ${quote(v.error)}.`, "run_tests");
      }
      if (v.failed === 0 && !v.error) {
        const fix = FORMAT_DURATION_FIXES.find((f) => appliedReplacements(messages).includes(f.replace));
        return reply(
          "all tests pass → finish",
          `Last result: run_tests passed=${quote(v.passed)}, failed=0. ${fix ? "An earlier edit_file applied a known fix; its description is the summary." : "No known fix was applied earlier."}`,
          "finish",
          { summary: fix?.summary ?? "All tests pass without changes." },
        );
      }
      const failures = Array.isArray(v.failures) ? (v.failures as { name?: string }[]) : [];
      const fromFailure = moduleFromFailure(v.failures);
      const path = fromFailure ?? "src/formatDuration.js";
      return reply(
        "tests fail → read the module of the first failing suite",
        `Last result: run_tests failed=${quote(v.failed)}${failures[0]?.name ? `, first failure ${quote(failures[0].name)}` : ""}${v.error ? `, error ${quote(v.error)}` : ""}. ${fromFailure ? `Suite name maps to ${path}.` : `No suite name; default path ${path}.`}`,
        "read_file",
        { path },
      );
    }
    case "read_file": {
      if (typeof v.contents !== "string") {
        return reply("read_file returned no contents → run_tests", `Last result: read_file ${v.error ? `error ${quote(v.error)}` : "without contents"}.`, "run_tests");
      }
      const fix = FORMAT_DURATION_FIXES.find((f) => (v.contents as string).includes(f.find));
      if (!fix) {
        return reply("no known buggy line in the file → run_tests", `Last result: ${quote(v.path)} contains none of the ${FORMAT_DURATION_FIXES.length} known buggy lines.`, "run_tests");
      }
      return reply(
        "known buggy line found → edit_file with its known fix",
        `Last result: ${quote(v.path)} contains the known buggy line ${quote(fix.find)}.`,
        "edit_file",
        { path: String(v.path), find: fix.find, replace: fix.replace },
      );
    }
    case "edit_file":
      if (v.ok) return reply("edit applied → run_tests", `Last result: edit_file ok for ${quote(v.path)}.`, "run_tests");
      return reply("edit failed → read_file again", `Last result: edit_file error ${quote(v.error)}.`, "read_file", { path: "src/formatDuration.js" });
    default:
      return reply("any other tool result → run_tests", `Last result came from ${quote(last.name)}.`, "run_tests");
  }
}

export class ScriptedBrain implements ChatModel {
  readonly id = SCRIPTED_MODEL_ID;
  readonly provider = "simulated";
  readonly label = "Simulated brain";

  async complete(request: CompletionRequest): Promise<Completion> {
    if (request.signal.aborted) throw request.signal.reason;
    // No usage field: the scripted brain has no tokens or runtime statistics to report.
    const { text, decision } = decide(request.messages);
    return { text, finishReason: "stop", decision };
  }
}
