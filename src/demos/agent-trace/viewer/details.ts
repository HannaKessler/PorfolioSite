/**
 * View models for the activity feed, the virtual project and the model calls.
 * Everything is rebuilt from span attributes, so live runs, recorded samples
 * and imported files all render the same way, and playback clipping applies.
 */
import { parseToolCall, type ParseResult } from "../agent/protocol";
import type { AttrValue } from "../collector/normalize";
import { APP, ERROR_TYPE, GEN_AI } from "../tracing/attrs";
import type { ViewSpan } from "./model";

export function parseJson<T = unknown>(v: AttrValue | undefined): T | undefined {
  if (typeof v !== "string") return undefined;
  try {
    return JSON.parse(v) as T;
  } catch {
    return undefined;
  }
}

const str = (v: AttrValue | undefined) => (typeof v === "string" ? v : undefined);
const int = (v: AttrValue | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

// ---------------------------------------------------------------------------
// Model calls

export interface ChatMessage {
  role: string;
  text: string;
  /** Tool results: the call they answer. */
  toolCallId?: string;
}

interface SemconvPart {
  type?: string;
  content?: unknown;
  response?: unknown;
  id?: string;
}

/** gen_ai.*.messages (role + typed parts) → one readable entry per message. */
export function parseMessages(v: AttrValue | undefined): ChatMessage[] | undefined {
  const list = parseJson<{ role?: string; parts?: SemconvPart[] }[]>(v);
  if (!Array.isArray(list)) return undefined;
  return list.map((m) => {
    const parts = Array.isArray(m.parts) ? m.parts : [];
    const text = parts
      .map((p) => (typeof p.content === "string" ? p.content : typeof p.response === "string" ? p.response : JSON.stringify(p)))
      .join("\n");
    const toolPart = parts.find((p) => p.type === "tool_call_response");
    return { role: String(m.role ?? "unknown"), text, toolCallId: toolPart?.id };
  });
}

export interface ModelCall {
  span: ViewSpan;
  step?: number;
  attempt: number;
  open: boolean;
  provider?: string;
  model?: string;
  /** The message list the brain received, or undefined if it could not be read. */
  messages?: ChatMessage[];
  /** The raw recorded attribute, shown when it cannot be parsed (e.g. truncated). */
  messagesRaw?: string;
  /** Raw reply text, before any parsing. */
  output?: string;
  finishReason?: string;
  /** The exact request body sent to the runtime (WebLLM only). */
  request?: string;
  /** The scripted policy's decision (simulated brain only). */
  policy?: { rule: string; condition: string };
  /** The shared validator's verdict on the raw reply. */
  parsed?: ParseResult;
  fault?: string;
  error?: string;
  truncated: boolean;
}

export function modelCall(v: ViewSpan): ModelCall {
  const a = v.span.attrs;
  const outMsgs = parseJson<{ parts?: SemconvPart[]; finish_reason?: string }[]>(a[GEN_AI.outputMessages]);
  const firstPart = Array.isArray(outMsgs) ? outMsgs[0]?.parts?.[0] : undefined;
  const output = typeof firstPart?.content === "string" ? firstPart.content : undefined;
  const finish = a[GEN_AI.responseFinishReasons];
  const rule = str(a[APP.policyRule]);
  const messages = parseMessages(a[GEN_AI.inputMessages]);
  return {
    span: v,
    step: int(a[APP.stepIndex]),
    attempt: int(a[APP.attempt]) ?? 1,
    open: v.endMs === null,
    provider: str(a[GEN_AI.providerName]),
    model: str(a[GEN_AI.requestModel]),
    messages,
    messagesRaw: messages ? undefined : str(a[GEN_AI.inputMessages]),
    output,
    finishReason: Array.isArray(finish) ? String(finish[0]) : str(finish),
    request: str(a[APP.llmRequest]),
    policy: rule ? { rule, condition: str(a[APP.policyCondition]) ?? "" } : undefined,
    parsed: output !== undefined && v.endMs !== null ? parseToolCall(output) : undefined,
    fault: v.fault,
    error: v.isError ? v.span.status.message ?? str(a[ERROR_TYPE]) : undefined,
    truncated: a[APP.truncated] === true,
  };
}

// ---------------------------------------------------------------------------
// Tool calls

export interface TestFailure {
  name: string;
  message: string;
}

export interface ToolCallView {
  span: ViewSpan;
  tool: string;
  attempt: number;
  open: boolean;
  args?: Record<string, unknown>;
  argsRaw?: string;
  result?: Record<string, unknown>;
  resultRaw?: string;
  errorType?: string;
  errorMessage?: string;
  tests?: { passed: number; failed: number; failures: TestFailure[]; error?: string };
  fault?: string;
}

export function toolCallView(v: ViewSpan): ToolCallView {
  const a = v.span.attrs;
  const args = parseJson<Record<string, unknown>>(a[GEN_AI.toolCallArguments]);
  const result = v.endMs === null ? undefined : parseJson<Record<string, unknown>>(a[GEN_AI.toolCallResult]);
  let tests: ToolCallView["tests"];
  if (v.tool === "run_tests" && result) {
    const failures = Array.isArray(result.failures)
      ? (result.failures as { name?: unknown; message?: unknown }[]).map((f) => ({ name: String(f.name ?? ""), message: String(f.message ?? "") }))
      : [];
    tests = {
      passed: Number(result.passed ?? 0),
      failed: Number(result.failed ?? 0),
      failures,
      error: typeof result.error === "string" ? result.error : undefined,
    };
  }
  return {
    span: v,
    tool: v.tool ?? "tool",
    attempt: int(a[APP.attempt]) ?? 1,
    open: v.endMs === null,
    args: args && typeof args === "object" ? args : undefined,
    argsRaw: args ? undefined : str(a[GEN_AI.toolCallArguments]),
    result: result && typeof result === "object" ? result : undefined,
    resultRaw: result || v.endMs === null ? undefined : str(a[GEN_AI.toolCallResult]),
    errorType: v.isError ? str(a[ERROR_TYPE]) : undefined,
    errorMessage: v.isError ? v.span.status.message : undefined,
    tests,
    fault: v.fault,
  };
}

// ---------------------------------------------------------------------------
// Activity feed

export interface ActivityStep {
  span: ViewSpan;
  index: number;
  open: boolean;
  outcome?: string;
  isError: boolean;
  error?: string;
  calls: ModelCall[];
  tools: ToolCallView[];
  /** Step mode: the pause before this step, if any. */
  pause?: ViewSpan;
}

export interface Activity {
  root?: ViewSpan;
  steps: ActivityStep[];
  /** Run outcome, once the root span has ended. */
  outcome?: string;
  brainLabel?: string;
  provider?: string;
}

export function buildActivity(spans: ViewSpan[]): Activity {
  const root = spans.find((s) => s.depth === 0);
  const byParent = new Map<string, ViewSpan[]>();
  for (const s of spans) {
    if (!s.parentId) continue;
    const list = byParent.get(s.parentId) ?? [];
    list.push(s);
    byParent.set(s.parentId, list);
  }
  const pauses = new Map<number, ViewSpan>();
  for (const s of spans) if (s.op === "pause" || s.span.attrs[APP.spanType] === "pause") pauses.set(int(s.span.attrs[APP.stepIndex]) ?? -1, s);
  const steps = spans
    .filter((s) => s.span.attrs[APP.spanType] === "step")
    .map((s): ActivityStep => {
      const children = (byParent.get(s.id) ?? []).slice().sort((x, y) => x.startMs - y.startMs);
      const index = int(s.span.attrs[APP.stepIndex]) ?? 0;
      return {
        span: s,
        index,
        open: s.endMs === null,
        outcome: s.endMs === null ? undefined : str(s.span.attrs[APP.stepOutcome]),
        isError: s.isError,
        error: s.isError ? s.span.status.message : undefined,
        calls: children.filter((c) => c.op === "chat").map(modelCall),
        tools: children.filter((c) => c.op === "execute_tool").map(toolCallView),
        pause: pauses.get(index),
      };
    })
    .sort((x, y) => x.span.startMs - y.span.startMs);
  return {
    root,
    steps,
    outcome: root && root.endMs !== null ? str(root.span.attrs[APP.runOutcome]) : undefined,
    brainLabel: str(root?.span.attrs[APP.brainLabel]),
    provider: str(root?.span.attrs[GEN_AI.providerName]),
  };
}

/** The feed item (step) that contains a span, for two-way selection. */
export function stepOf(activity: Activity, spanId: string | undefined): ActivityStep | undefined {
  if (!spanId) return undefined;
  return activity.steps.find((s) => s.span.id === spanId || s.calls.some((c) => c.span.id === spanId) || s.tools.some((t) => t.span.id === spanId) || s.pause?.id === spanId);
}

// ---------------------------------------------------------------------------
// Virtual project

export interface EditRecord {
  span: ViewSpan;
  step?: number;
  path: string;
  find?: string;
  replace?: string;
  before?: string;
  after?: string;
  matches?: number;
  open: boolean;
  applied: boolean;
  error?: string;
}

export interface ProjectState {
  /** False when the trace has no file snapshot (recorded before files were traced). */
  available: boolean;
  truncated: boolean;
  initial: Record<string, string>;
  /** Files at the chosen point. */
  files: Record<string, string>;
  /** Every edit_file call in the (playback-clipped) trace. */
  edits: EditRecord[];
  /** Paths changed by an applied edit up to the chosen point. */
  changed: Set<string>;
}

const normPath = (p: string) => p.replace(/\\/g, "/").split("/").filter((x) => x && x !== ".").join("/");

export function editRecord(v: ViewSpan): EditRecord {
  const a = v.span.attrs;
  const args = parseJson<Record<string, unknown>>(a[GEN_AI.toolCallArguments]) ?? {};
  const ended = v.endMs !== null;
  const after = ended ? str(a[APP.fileAfter]) : undefined;
  return {
    span: v,
    step: int(a[APP.stepIndex]),
    path: normPath(str(a[APP.filePath]) ?? String(args.path ?? "")),
    find: typeof args.find === "string" ? args.find : undefined,
    replace: typeof args.replace === "string" ? args.replace : undefined,
    before: ended ? str(a[APP.fileBefore]) : undefined,
    after,
    matches: ended ? int(a[APP.editMatches]) : undefined,
    open: !ended,
    applied: ended && after !== undefined && !v.isError,
    error: ended && v.isError ? v.span.status.message : undefined,
  };
}

/**
 * Rebuilds the project from the recorded start snapshot and the recorded
 * after-state of each applied edit that ended by `untilMs` (all ended edits when
 * undefined). Nothing is re-executed or inferred.
 */
export function projectAt(spans: ViewSpan[], untilMs?: number): ProjectState {
  const root = spans.find((s) => s.depth === 0);
  const raw = root?.span.attrs[APP.vfsFiles];
  const initial = parseJson<Record<string, string>>(raw);
  const edits = spans.filter((s) => s.op === "execute_tool" && s.tool === "edit_file").sort((a, b) => a.startMs - b.startMs).map(editRecord);
  if (!initial || typeof initial !== "object") {
    return { available: false, truncated: typeof raw === "string", initial: {}, files: {}, edits, changed: new Set() };
  }
  const files: Record<string, string> = { ...initial };
  const changed = new Set<string>();
  for (const e of edits) {
    if (!e.applied || e.after === undefined) continue;
    if (untilMs !== undefined && (e.span.endMs ?? Infinity) > untilMs) continue;
    files[e.path] = e.after;
    changed.add(e.path);
  }
  return { available: true, truncated: false, initial, files, edits, changed };
}

export interface TreeNode {
  name: string;
  path: string;
  children?: TreeNode[];
}

/** Sorted directory tree for a set of POSIX paths: folders first, then files. */
export function fileTree(paths: string[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", children: [] };
  for (const p of [...paths].sort()) {
    const parts = p.split("/");
    let node = root;
    parts.forEach((part, i) => {
      const path = parts.slice(0, i + 1).join("/");
      if (i === parts.length - 1) {
        node.children!.push({ name: part, path });
        return;
      }
      let next = node.children!.find((c) => c.children && c.name === part);
      if (!next) {
        next = { name: part, path, children: [] };
        node.children!.push(next);
      }
      node = next;
    });
  }
  const sort = (n: TreeNode) => {
    n.children?.sort((a, b) => Number(!a.children) - Number(!b.children) || a.name.localeCompare(b.name));
    n.children?.forEach(sort);
  };
  sort(root);
  return root.children!;
}

// ---------------------------------------------------------------------------
// Line diff

export interface DiffLine {
  type: "same" | "add" | "del";
  text: string;
  /** 1-based line numbers in the old and new file. */
  oldNo?: number;
  newNo?: number;
}

const splitLines = (s: string) => {
  const lines = s.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
};

/** Longest-common-subsequence line diff. */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = splitLines(before);
  const b = splitLines(after);
  const n = a.length;
  const m = b.length;
  const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      out.push({ type: "same", text: a[i], oldNo: i + 1, newNo: j + 1 });
      i++;
      j++;
    } else if (i < n && (j === m || lcs[i + 1][j] >= lcs[i][j + 1])) {
      out.push({ type: "del", text: a[i], oldNo: i + 1 });
      i++;
    } else {
      out.push({ type: "add", text: b[j], newNo: j + 1 });
      j++;
    }
  }
  return out;
}
