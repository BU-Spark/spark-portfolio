"use client";
// Small clipboard button. Copies `value` and flashes "copied ✓" for 2500ms.
// Inline-styled to match the admin design tokens.
import { useEffect, useRef, useState } from "react";

export default function CopyButton({
  value,
  title = "Copy",
}: {
  value: string;
  title?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Fallback for non-secure contexts.
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {}
      document.body.removeChild(ta);
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2500);
  };

  return (
    <button
      type="button"
      title={title}
      onClick={onCopy}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        border: "1px solid var(--line)",
        background: "#fff",
        color: copied ? "var(--accent)" : "var(--sec)",
        borderRadius: 6,
        padding: "5px 9px",
        fontFamily: "var(--mono)",
        fontSize: 12,
        cursor: "pointer",
        transition: "color .15s, border-color .15s",
        whiteSpace: "nowrap",
      }}
    >
      {copied ? (
        "copied ✓"
      ) : (
        <>
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          Copy
        </>
      )}
    </button>
  );
}
