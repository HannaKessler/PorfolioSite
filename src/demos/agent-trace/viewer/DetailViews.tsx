import { useRef, type KeyboardEvent } from "react";
import { ActivityFeed } from "./ActivityFeed";
import { ModelCalls } from "./ModelCalls";
import { ProjectFiles } from "./ProjectFiles";
import type { ViewSpan } from "./model";
import { DETAIL_VIEWS, type DetailView } from "./url-state";

const TITLES: Record<DetailView, string> = { activity: "Activity", files: "Files", prompts: "Prompts" };
const HINTS: Record<DetailView, string> = {
  activity: "Each step as it happened: reasoning or rule, tool call, result and outcome.",
  files: "The virtual project at the selected point, and a diff for every edit_file call.",
  prompts: "The full message list and the raw reply for every model call.",
};

/** Activity, Files and Prompts: three readings of the same spans. */
export function DetailViews({ view, onView, spans, selected, onSelect, playbackMs, live }: {
  view: DetailView;
  onView: (v: DetailView) => void;
  spans: ViewSpan[];
  selected?: ViewSpan;
  onSelect: (id: string) => void;
  playbackMs?: number;
  live: boolean;
}) {
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent) => {
    const i = DETAIL_VIEWS.indexOf(view);
    const next = e.key === "ArrowRight" ? (i + 1) % DETAIL_VIEWS.length : e.key === "ArrowLeft" ? (i + DETAIL_VIEWS.length - 1) % DETAIL_VIEWS.length : -1;
    if (next < 0) return;
    e.preventDefault();
    onView(DETAIL_VIEWS[next]);
    tabs.current[next]?.focus();
  };
  return (
    <section className="atv-views" aria-label="Run details">
      <div className="atv-tabs" role="tablist" aria-label="Run details" onKeyDown={onKey}>
        {DETAIL_VIEWS.map((v, i) => (
          <button
            key={v}
            ref={(el) => {
              tabs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`atv-tab-${v}`}
            aria-selected={view === v}
            aria-controls={`atv-panel-${v}`}
            tabIndex={view === v ? 0 : -1}
            className={`atv-tab${view === v ? " is-active" : ""}`}
            onClick={() => onView(v)}
          >
            {TITLES[v]}
          </button>
        ))}
        <span className="atv-tabs-hint atv-muted">{HINTS[view]}</span>
      </div>
      <div className="atv-tabpanel" role="tabpanel" id={`atv-panel-${view}`} aria-labelledby={`atv-tab-${view}`}>
        {view === "activity" && <ActivityFeed spans={spans} selectedId={selected?.id} onSelect={onSelect} live={live} />}
        {view === "files" && <ProjectFiles spans={spans} selected={selected} onSelect={onSelect} playbackMs={playbackMs} live={live} />}
        {view === "prompts" && <ModelCalls spans={spans} selectedId={selected?.id} onSelect={onSelect} />}
      </div>
    </section>
  );
}
