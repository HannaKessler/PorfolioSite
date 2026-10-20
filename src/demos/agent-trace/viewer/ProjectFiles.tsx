import { useEffect, useMemo, useState } from "react";
import { fileTree, lineDiff, projectAt, type DiffLine, type EditRecord, type TreeNode } from "./details";
import { formatMs, type ViewSpan } from "./model";
import { Selectable } from "./Selectable";

function Lines({ text }: { text: string }) {
  const lines = text.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return (
    <pre className="atv-code" aria-label="File contents">
      {lines.map((l, i) => (
        <span key={i} className="atv-code-line">
          <span className="atv-ln" aria-hidden="true">{i + 1}</span>
          <span>{l || " "}</span>
        </span>
      ))}
    </pre>
  );
}

export function Diff({ lines, label }: { lines: DiffLine[]; label: string }) {
  return (
    <pre className="atv-code atv-diff" aria-label={label}>
      {lines.map((l, i) => (
        <span key={i} className={`atv-code-line atv-diff-${l.type}`}>
          <span className="atv-ln" aria-hidden="true">{l.oldNo ?? ""}</span>
          <span className="atv-ln" aria-hidden="true">{l.newNo ?? ""}</span>
          <span className="atv-diff-sign" aria-hidden="true">{l.type === "add" ? "+" : l.type === "del" ? "−" : " "}</span>
          <span>
            {l.type !== "same" && <span className="atv-sr">{l.type === "add" ? "Added: " : "Removed: "}</span>}
            {l.text || " "}
          </span>
        </span>
      ))}
    </pre>
  );
}

function Tree({ nodes, open, changed, onOpen }: { nodes: TreeNode[]; open?: string; changed: Set<string>; onOpen: (p: string) => void }) {
  return (
    <ul className="atv-tree">
      {nodes.map((n) =>
        n.children ? (
          <li key={n.path}>
            <span className="atv-tree-dir">{n.name}/</span>
            <Tree nodes={n.children} open={open} changed={changed} onOpen={onOpen} />
          </li>
        ) : (
          <li key={n.path}>
            <button type="button" className={`atv-tree-file${n.path === open ? " is-open" : ""}`} aria-current={n.path === open} onClick={() => onOpen(n.path)}>
              {n.name}
              {changed.has(n.path) && <span className="atv-tree-mod" title="Changed by an edit">modified</span>}
            </button>
          </li>
        ),
      )}
    </ul>
  );
}

function EditDetail({ edit }: { edit: EditRecord }) {
  if (edit.open) return <p className="atv-muted">This edit_file call is still running at this point.</p>;
  return (
    <div className="atv-edit-detail">
      {edit.applied && edit.before !== undefined && edit.after !== undefined ? (
        <>
          <p className="atv-info-text">
            Applied to <code>{edit.path}</code>: the find text occurred once and was replaced.
          </p>
          <Diff lines={lineDiff(edit.before, edit.after)} label={`Changes to ${edit.path}`} />
        </>
      ) : edit.applied ? (
        <p className="atv-info-text">Applied to <code>{edit.path}</code>. This trace has no before and after contents for it.</p>
      ) : (
        <>
          <p className="atv-error-text">
            Not applied: {edit.error ?? "the edit failed"}
            {edit.matches !== undefined ? `. The find text occurs ${edit.matches} time${edit.matches === 1 ? "" : "s"} in the file; edit_file needs exactly one.` : "."}
          </p>
          <div className="atv-edit-attempt">
            <div>
              <p className="atv-label">Find (as sent by the brain)</p>
              <pre className="atv-pre">{edit.find ?? ""}</pre>
            </div>
            <div>
              <p className="atv-label">Replace with</p>
              <pre className="atv-pre">{edit.replace ?? ""}</pre>
            </div>
          </div>
          {edit.before !== undefined ? (
            <>
              <p className="atv-label">
                <code>{edit.path}</code> when the edit was attempted
              </p>
              <Lines text={edit.before} />
            </>
          ) : (
            <p className="atv-muted">
              {edit.error?.startsWith("File not found") ? "The file did not exist, so there are no contents to show." : "This trace did not record the file contents for this call."}
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** The virtual project: files at the chosen point, and every edit_file call with its diff. */
export function ProjectFiles({ spans, selected, onSelect, playbackMs, live }: {
  spans: ViewSpan[];
  selected?: ViewSpan;
  onSelect: (id: string) => void;
  playbackMs?: number;
  live: boolean;
}) {
  const untilMs = selected ? selected.endMs ?? selected.startMs : undefined;
  const state = useMemo(() => projectAt(spans, untilMs), [spans, untilMs]);
  const paths = Object.keys(state.files).sort();
  const selectedEdit = state.edits.find((e) => e.span.id === selected?.id);
  const [openPath, setOpenPath] = useState<string>();
  const [focusEdit, setFocusEdit] = useState(true);
  useEffect(() => setFocusEdit(true), [selected?.id]);
  const current = openPath && paths.includes(openPath) ? openPath : selectedEdit?.path && paths.includes(selectedEdit.path) ? selectedEdit.path : [...state.changed][0] ?? paths.find((p) => !p.includes("test")) ?? paths[0];
  const tree = useMemo(() => fileTree(paths), [paths.join("\n")]);

  const point = selected
    ? `after ${selected.span.name}${selected.endMs === null ? " (still running)" : ""} at ${formatMs(untilMs ?? 0)}`
    : playbackMs !== undefined
      ? `at the playback position, ${formatMs(playbackMs)}`
      : live
        ? "now (run in progress)"
        : "at the end of the run";

  const contents = current !== undefined ? state.files[current] : undefined;
  const initial = current !== undefined ? state.initial[current] : undefined;
  const showEdit = selectedEdit && focusEdit;

  return (
    <div className="atv-files">
      <div className="atv-files-side">
        <p className="atv-label">Files {point}</p>
        {state.available ? (
          <Tree nodes={tree} open={showEdit ? undefined : current} changed={state.changed} onOpen={(p) => { setOpenPath(p); setFocusEdit(false); }} />
        ) : (
          <p className="atv-muted">
            {state.truncated
              ? "The file snapshot in this trace was truncated when it was recorded, so the files can't be rebuilt."
              : "This trace has no file snapshot (app.vfs.files), so the files can't be rebuilt. Its edit_file calls are listed below."}
          </p>
        )}
        <p className="atv-label atv-files-edits-title">edit_file calls ({state.edits.length})</p>
        {state.edits.length === 0 ? (
          <p className="atv-muted">None at this point in the run.</p>
        ) : (
          <ol className="atv-edits">
            {state.edits.map((e) => (
              <li key={e.span.id}>
                <Selectable id={e.span.id} selectedId={selected?.id} onSelect={(id) => { onSelect(id); setFocusEdit(true); }} className={`atv-edit-item${e.open ? "" : e.applied ? " is-ok" : " is-error"}`}>
                  <span>Step {e.step ?? "?"}</span>
                  <span className="atv-edit-status">{e.open ? "running" : e.applied ? "applied" : e.error ?? "failed"}</span>
                </Selectable>
              </li>
            ))}
          </ol>
        )}
      </div>
      <div className="atv-files-main">
        {showEdit ? (
          <>
            <div className="atv-files-head">
              <h4>
                edit_file · step {selectedEdit.step ?? "?"} · <code>{selectedEdit.path}</code>
              </h4>
            </div>
            <EditDetail edit={selectedEdit} />
          </>
        ) : contents !== undefined && current ? (
          <>
            <div className="atv-files-head">
              <h4>
                <code>{current}</code>
              </h4>
              <span className="atv-muted">{state.changed.has(current) ? "Changed since the start of the run: lines marked + and −" : "Unchanged since the start of the run"}</span>
            </div>
            {state.changed.has(current) && initial !== undefined ? <Diff lines={lineDiff(initial, contents)} label={`Changes to ${current} since the start`} /> : <Lines text={contents} />}
          </>
        ) : (
          <p className="atv-muted">{state.available ? "Select a file." : "Select an edit_file call to see what it tried to change."}</p>
        )}
      </div>
    </div>
  );
}
