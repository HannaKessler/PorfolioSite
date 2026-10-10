import { useId } from "react";

interface Props {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
}

/** A checkbox styled as a switch; keeps native keyboard and screen reader behaviour. */
export function Switch({ checked, onChange, label, hint }: Props) {
  const id = useId();
  return (
    <div className="fg-switch">
      <input id={id} type="checkbox" role="switch" checked={checked} onChange={(event) => onChange(event.target.checked)} aria-describedby={hint ? `${id}-hint` : undefined} />
      <label htmlFor={id}>
        <span className="fg-switch-track" aria-hidden="true" />
        <span className="fg-switch-text">
          {label}
          {hint && (
            <span id={`${id}-hint`} className="fg-switch-hint">
              {hint}
            </span>
          )}
        </span>
      </label>
    </div>
  );
}
