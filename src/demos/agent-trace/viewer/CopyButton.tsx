import { useEffect, useState } from "react";

/** Copies text to the clipboard and says whether it worked. */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => setState("idle"), 1500);
    return () => clearTimeout(t);
  }, [state]);
  return (
    <button
      type="button"
      className="atv-copy"
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard?.writeText(text).then(
          () => setState("copied"),
          () => setState("failed"),
        ) ?? setState("failed");
      }}
    >
      {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : label}
    </button>
  );
}
