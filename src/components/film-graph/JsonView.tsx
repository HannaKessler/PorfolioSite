import { useMemo } from "react";
import { formatBytes, jsonBytes } from "../../filmgraph/client/metrics";

interface Props {
  value: unknown;
  label: string;
}

/** Pretty-printed JSON in a scrollable, focusable region. */
export function JsonView({ value, label }: Props) {
  const text = useMemo(() => JSON.stringify(value, null, 2) ?? "null", [value]);
  const lines = useMemo(() => text.split("\n").length, [text]);
  return (
    <figure className="fg-json">
      <figcaption>
        {label} · {lines.toLocaleString("en-US")} lines · {formatBytes(jsonBytes(value))} as compact JSON
      </figcaption>
      <pre tabIndex={0} aria-label={label}>
        <code>{text}</code>
      </pre>
    </figure>
  );
}
