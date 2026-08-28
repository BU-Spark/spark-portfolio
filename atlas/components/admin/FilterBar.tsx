"use client";
// Collapsible filter container for admin list pages. Collapsed by default to keep
// lists uncluttered; the header shows "Filters" + an activeCount pill, and toggles
// to reveal `children` (the actual filter controls). Uses the shared .filterbar css.
import { useEffect, useState } from "react";

export default function FilterBar({
  activeCount = 0,
  defaultOpen = false,
  children,
}: {
  activeCount?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  // `defaultOpen` can arrive late — a page restoring saved filters starts with a
  // count of 0 and only knows it should be open a render later. Force-open only:
  // never auto-collapse, or manually closing the bar would fight the caller.
  useEffect(() => {
    if (defaultOpen) setOpen(true);
  }, [defaultOpen]);

  return (
    <div className="filterbar-wrap">
      <button
        type="button"
        className="filterbar__toggle"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="filterbar__caret" data-open={open ? "true" : "false"} aria-hidden>
          ▸
        </span>
        Filters
        {activeCount > 0 && <span className="countpill">{activeCount}</span>}
      </button>
      <div className={`filterbar${open ? "" : " filterbar--collapsed"}`}>{children}</div>
    </div>
  );
}
