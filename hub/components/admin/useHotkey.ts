"use client";
// Minimal keyboard-shortcut hook. Supports:
//   "mod+s"  → Cmd/Ctrl+S, preventDefault()'d (typically save)
//   "escape" → Escape key
// The handler is held in a ref so the listener doesn't churn on every render.
import { useEffect, useRef } from "react";

export function useHotkey(combo: string, handler: () => void) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const target = combo.toLowerCase().trim();
    const onKey = (e: KeyboardEvent) => {
      if (target === "mod+s") {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
          e.preventDefault();
          handlerRef.current();
        }
      } else if (target === "escape") {
        if (e.key === "Escape") handlerRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [combo]);
}
