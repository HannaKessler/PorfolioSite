import type { KeyboardEvent } from "react";

interface Props<T extends string> {
  label: string;
  value: T;
  onChange: (value: T) => void;
  tabs: { id: T; label: string }[];
  idPrefix: string;
}

/** ARIA tabs with arrow-key, Home and End navigation. */
export function Tabs<T extends string>({ label, value, onChange, tabs, idPrefix }: Props<T>) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex((tab) => tab.id === value);
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    onChange(tabs[next].id);
    document.getElementById(`${idPrefix}-tab-${tabs[next].id}`)?.focus();
  };
  return (
    <div className="fg-tabs" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          id={`${idPrefix}-tab-${tab.id}`}
          type="button"
          role="tab"
          aria-selected={tab.id === value}
          aria-controls={`${idPrefix}-panel-${tab.id}`}
          tabIndex={tab.id === value ? 0 : -1}
          className="fg-tab"
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
