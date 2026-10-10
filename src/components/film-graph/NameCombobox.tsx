import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { BlankKind, Choice } from "../../filmgraph/client/presets";
import { searchable, type Suggestion } from "../../filmgraph/client/search";

export interface SearchOutcome {
  suggestions: Suggestion[];
  /** e.g. "POST /graphql · 3 SQL · 4 ms", shown under the list. */
  via: string;
}

interface Props {
  kind: BlankKind;
  label: string;
  value: Choice;
  onChange: (choice: Choice) => void;
  /** Searches the in-browser backend. Starting the backend is the caller's job. */
  search: (kind: BlankKind, text: string) => Promise<SearchOutcome>;
  /** Called on the first keystroke so the backend can start booting. */
  onFirstInput: () => void;
  booting: boolean;
}

const PLACEHOLDER: Record<BlankKind, string> = { director: "a director", actor: "an actor", studio: "a studio" };

/**
 * An inline blank in the question sentence: a WAI-ARIA combobox (editable,
 * list autocomplete) that searches names in the backend as you type.
 * Down/Up move through suggestions, Enter picks one, Escape closes the list
 * (or restores the chosen name), and leaving the field without picking keeps
 * the previous choice.
 */
export function NameCombobox({ kind, label, value, onChange, search, onFirstInput, booting }: Props) {
  const id = useId();
  const listId = `${id}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const [text, setText] = useState(value.name);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [outcome, setOutcome] = useState<SearchOutcome | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shift, setShift] = useState(0);
  const sequence = useRef(0);

  // A new question (or an outside change) resets the text to the chosen name.
  useEffect(() => {
    setText(value.name);
  }, [value.id, value.name]);

  useEffect(() => {
    if (!open) return;
    const query = text.trim();
    if (!searchable(query) || query === value.name) return;
    const ticket = ++sequence.current;
    setLoading(true);
    const timer = setTimeout(() => {
      search(kind, query)
        .then((result) => {
          if (ticket !== sequence.current) return;
          setOutcome(result);
          setError(null);
          setActive(result.suggestions.length ? 0 : -1);
        })
        .catch((reason: Error) => ticket === sequence.current && setError(reason.message))
        .finally(() => ticket === sequence.current && setLoading(false));
    }, 140);
    return () => clearTimeout(timer);
  }, [text, open, kind, search, value.name]);

  // Keep the dropdown inside the viewport: shift it left if it would overflow.
  useLayoutEffect(() => {
    if (!open || !wrapRef.current) return;
    const list = wrapRef.current.querySelector<HTMLElement>(".fg-combo-list");
    if (!list) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const room = document.documentElement.clientWidth - 12;
    const overflow = rect.left + list.offsetWidth - room;
    setShift(overflow > 0 ? -Math.min(overflow, Math.max(0, rect.left - 12)) : 0);
  }, [open, outcome, loading]);

  const suggestions = outcome?.suggestions ?? [];
  const showList = open && (loading || booting || !!error || !!outcome);

  const close = (restore: boolean) => {
    setOpen(false);
    setActive(-1);
    if (restore) setText(value.name);
  };

  const pick = (suggestion: Suggestion) => {
    onChange({ id: suggestion.id, name: suggestion.name });
    setText(suggestion.name);
    close(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (!suggestions.length) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) => (index + step + suggestions.length) % suggestions.length);
    } else if (event.key === "Enter") {
      if (open && active >= 0 && suggestions[active]) {
        event.preventDefault();
        pick(suggestions[active]);
      }
    } else if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        close(false);
      } else {
        setText(value.name);
      }
    }
  };

  const activeId = open && active >= 0 && suggestions[active] ? `${id}-opt-${active}` : undefined;
  const size = Math.max(PLACEHOLDER[kind].length, text.length) + 1;

  return (
    <span className="fg-combo" ref={wrapRef} data-kind={kind}>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        className="fg-blank"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={activeId}
        autoComplete="off"
        autoCapitalize="words"
        spellCheck={false}
        placeholder={PLACEHOLDER[kind]}
        size={size}
        value={text}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => {
          onFirstInput();
          setText(event.target.value);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => close(true)}
      />
      <span className="fg-combo-pop" hidden={!showList} style={{ transform: shift ? `translateX(${shift}px)` : undefined }}>
        <ul id={listId} role="listbox" aria-label={`${label} suggestions`} className="fg-combo-list">
          {suggestions.map((suggestion, index) => (
            <li
              key={suggestion.id}
              id={`${id}-opt-${index}`}
              role="option"
              aria-selected={index === active}
              className="fg-combo-option"
              // mousedown, not click, so the input's blur doesn't close the list first.
              onMouseDown={(event) => {
                event.preventDefault();
                pick(suggestion);
              }}
              onMouseMove={() => setActive(index)}
            >
              <span className="fg-combo-name">{suggestion.name}</span>
              {suggestion.detail && <span className="fg-combo-detail">{suggestion.detail}</span>}
            </li>
          ))}
        </ul>
        <span className="fg-combo-status" aria-live="polite">
          {booting
            ? "Starting the database in your browser…"
            : error
              ? `Search failed: ${error}`
              : loading
                ? "Searching…"
                : outcome && !suggestions.length
                  ? `No ${kind === "studio" ? "studios" : `${kind}s`} match “${text.trim()}”.`
                  : outcome
                    ? `${suggestions.length} match${suggestions.length === 1 ? "" : "es"} · ${outcome.via}`
                    : ""}
        </span>
      </span>
    </span>
  );
}
