"use client";
// Shared toast hook. Replaces the duplicated toast state + auto-dismiss timer
// that every admin page hand-rolls. Returns { toastEl, notify }:
//   notify("ok"|"err", msg) shows a .toast that auto-dismisses after ~4.2s;
//   toastEl is the rendered node to drop into the page's JSX.
import { useCallback, useEffect, useRef, useState } from "react";

type ToastKind = "ok" | "err";

export function useToast() {
  const [toast, setToast] = useState<{ type: ToastKind; msg: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((type: ToastKind, msg: string) => {
    setToast({ type, msg });
  }, []);

  useEffect(() => {
    if (!toast) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 4200);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [toast]);

  // Spark Control pill toast (bottom-center, teal/rose dot). `.sc-toast` is
  // scoped to .spark-control (the admin shell), so this only affects admin pages.
  const toastEl = toast ? (
    <div className={`sc-toast ${toast.type === "err" ? "err" : ""}`}>
      <span className="dot" />
      {toast.msg}
    </div>
  ) : null;

  return { toastEl, notify };
}
