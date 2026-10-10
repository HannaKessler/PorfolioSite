import type { BlankKind, Choice, Preset } from "../../filmgraph/client/presets";
import { NameCombobox, type SearchOutcome } from "./NameCombobox";

interface Props {
  presets: Preset[];
  preset: Preset;
  choices: Record<string, Choice>;
  onPreset: (preset: Preset) => void;
  onChoice: (variable: string, choice: Choice) => void;
  onRun: () => void;
  search: (kind: BlankKind, text: string) => Promise<SearchOutcome>;
  onFirstInput: () => void;
  booting: boolean;
  running: boolean;
  disabled: boolean;
  /** Short live status after a run, e.g. "Done: 1 GraphQL request, 15 REST calls." */
  status: string;
}

/** "Every film [director] directed…" with the blank words styled as blanks. */
function TemplateLabel({ label }: { label: string }) {
  return (
    <>
      {label.split(/(\[[^\]]+\])/).map((part, index) =>
        part.startsWith("[") ? (
          <span key={index} className="fg-chip-blank">
            {part.slice(1, -1)}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

/**
 * Mad Libs style question builder: pick a question template, fill each blank
 * by searching real names, then press Run. Nothing runs until Run.
 */
export function QuestionBuilder(props: Props) {
  const { presets, preset, choices, onPreset, onChoice, onRun, search, onFirstInput, booting, running, disabled, status } = props;
  return (
    <section className="fg-section" aria-labelledby="fg-question-title">
      <div className="fg-section-head">
        <h2 id="fg-question-title">Ask a question</h2>
        <p>Pick a question, type names into the blanks, then press Run.</p>
      </div>
      <div className="fg-presets" role="group" aria-label="Questions">
        {presets.map((item) => (
          <button
            key={item.id}
            type="button"
            className="fg-chip"
            aria-pressed={item.id === preset.id}
            onClick={() => onPreset(item)}
          >
            <TemplateLabel label={item.label} />
          </button>
        ))}
      </div>
      <form
        className="fg-question"
        aria-label="Question"
        onSubmit={(event) => {
          event.preventDefault();
          onRun();
        }}
      >
        <p className="fg-sentence">
          {preset.sentence.map((part, index) =>
            typeof part === "string" ? (
              <span key={index}>{part}</span>
            ) : (
              <NameCombobox
                key={`${preset.id}-${part.variable}`}
                kind={part.kind}
                label={part.label}
                value={choices[part.variable] ?? part.default}
                onChange={(choice) => onChoice(part.variable, choice)}
                search={search}
                onFirstInput={onFirstInput}
                booting={booting}
              />
            ),
          )}
        </p>
        <button type="submit" className="button button-primary fg-run" disabled={disabled}>
          {running ? "Running…" : "Run"}
        </button>
      </form>
      <p className="fg-summary">
        {preset.summary}{" "}
        <span className="fg-run-status" role="status">
          {status}
        </span>
      </p>
    </section>
  );
}
