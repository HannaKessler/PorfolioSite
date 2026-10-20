import type { KeyboardEvent, ReactNode } from "react";

/** A block that selects a span when clicked or activated with Enter or Space. */
export function Selectable({ id, selectedId, onSelect, className, children }: {
  id: string;
  selectedId?: string;
  onSelect: (id: string) => void;
  className: string;
  children: ReactNode;
}) {
  const selected = id === selectedId;
  const onKey = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(id);
    }
  };
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      data-span={id}
      className={`${className}${selected ? " is-selected" : ""}`}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button, a, summary") && e.target !== e.currentTarget) return;
        onSelect(id);
      }}
      onKeyDown={onKey}
    >
      {children}
    </div>
  );
}
