"use client";
// Admin-only editor for a project's contacts: a list of {name, email} rows shown
// in two columns, with a remove button per row and an "Add contact" button that
// appends a fresh row. Used by both the new-project and edit-project forms.
import { useRef } from "react";
import type { ProjectContact } from "@/lib/types";

const ACCENT = "#0fa392";

export default function ContactsEditor({
  value,
  onChange,
}: {
  value: ProjectContact[];
  onChange: (next: ProjectContact[]) => void;
}) {
  const rows = value ?? [];

  // Stable React keys per row, kept in a ref so editing a row (which spreads a
  // new object) doesn't change its key and remount the input — that would drop
  // focus on every keystroke. Keys are NOT persisted; cleanContacts() on save
  // only reads {name, email}. Aligned with `rows` in the add/remove handlers and
  // padded here when the parent first loads contacts (value: [] → N rows).
  const keys = useRef<number[]>([]);
  const nextKey = useRef(0);
  if (keys.current.length < rows.length) {
    while (keys.current.length < rows.length) keys.current.push(nextKey.current++);
  } else if (keys.current.length > rows.length) {
    keys.current = keys.current.slice(0, rows.length);
  }

  const update = (i: number, patch: Partial<ProjectContact>) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const add = () => {
    keys.current.push(nextKey.current++);
    onChange([...rows, { name: "", email: "" }]);
  };
  const remove = (i: number) => {
    keys.current.splice(i, 1);
    onChange(rows.filter((_, idx) => idx !== i));
  };

  return (
    <div>
      {rows.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 34px",
            gap: 8,
            marginBottom: 6,
            fontFamily: "var(--mono)",
            fontSize: 11,
            color: "#9a9a9a",
          }}
        >
          <span>Name</span>
          <span>Email</span>
          <span />
        </div>
      )}

      {rows.map((row, i) => (
        <div
          key={keys.current[i]}
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 34px",
            gap: 8,
            marginBottom: 8,
            alignItems: "center",
          }}
        >
          <input
            className="fld"
            value={row.name}
            onChange={(e) => update(i, { name: e.target.value })}
            placeholder="Contact name"
          />
          <input
            className="fld"
            type="email"
            value={row.email}
            onChange={(e) => update(i, { email: e.target.value })}
            placeholder="email@bu.edu"
          />
          <button
            type="button"
            onClick={() => remove(i)}
            aria-label="Remove contact"
            title="Remove contact"
            style={{
              height: 34,
              border: "1px solid var(--line, #e3e3e3)",
              borderRadius: 6,
              background: "#fff",
              color: "#9a3b3b",
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            ✕
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={add}
        style={{
          marginTop: rows.length ? 2 : 0,
          border: `1px dashed ${ACCENT}`,
          borderRadius: 6,
          background: "transparent",
          color: ACCENT,
          fontFamily: "var(--mono)",
          fontSize: 12.5,
          padding: "7px 12px",
          cursor: "pointer",
        }}
      >
        + Add contact
      </button>
    </div>
  );
}
