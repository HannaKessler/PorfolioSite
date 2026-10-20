/**
 * The JSON tool-call protocol. Every brain returns raw text containing one JSON
 * object; this module is the only place that turns text into a tool call.
 */

export const TOOL_NAMES = ["read_file", "edit_file", "run_tests", "finish"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export interface ToolCall {
  tool: ToolName;
  args: Record<string, string>;
  thought?: string;
}

const REQUIRED_ARGS: Record<ToolName, string[]> = {
  read_file: ["path"],
  edit_file: ["path", "find", "replace"],
  run_tests: [],
  finish: ["summary"],
};

/** JSON Schema for one tool call, passed to schema-constrained JSON decoding. */
export const TOOL_CALL_SCHEMA = {
  type: "object",
  properties: {
    thought: { type: "string" },
    tool: { type: "string", enum: [...TOOL_NAMES] },
    args: {
      type: "object",
      properties: {
        path: { type: "string" },
        find: { type: "string" },
        replace: { type: "string" },
        summary: { type: "string" },
      },
    },
  },
  required: ["tool", "args"],
} as const;

export type ParseResult = { ok: true; call: ToolCall } | { ok: false; error: string };

/** Parses and validates a tool call. Accepts an optional Markdown code fence around the JSON. */
export function parseToolCall(text: string): ParseResult {
  let body = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(body);
  if (fence) body = fence[1];
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch (e) {
    return { ok: false, error: `Reply is not valid JSON (${e instanceof Error ? e.message : String(e)})` };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, error: "Reply must be a JSON object" };
  }
  const obj = value as Record<string, unknown>;
  if (typeof obj.tool !== "string" || !(TOOL_NAMES as readonly string[]).includes(obj.tool)) {
    return { ok: false, error: `"tool" must be one of ${TOOL_NAMES.join(", ")}` };
  }
  const tool = obj.tool as ToolName;
  const rawArgs = obj.args ?? {};
  if (typeof rawArgs !== "object" || rawArgs === null || Array.isArray(rawArgs)) {
    return { ok: false, error: `"args" must be an object` };
  }
  const args: Record<string, string> = {};
  for (const key of REQUIRED_ARGS[tool]) {
    const v = (rawArgs as Record<string, unknown>)[key];
    if (typeof v !== "string") return { ok: false, error: `${tool} needs a string "${key}" argument` };
    args[key] = v;
  }
  if (tool === "edit_file" && args.find === "") return { ok: false, error: `edit_file needs a non-empty "find" argument` };
  const call: ToolCall = { tool, args };
  if (typeof obj.thought === "string") call.thought = obj.thought;
  return { ok: true, call };
}
