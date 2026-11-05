// "Known aliases" under a project title — a native <details>, collapsed by default,
// rendered by both the public page (ProjectView) and the admin preview. Renders
// nothing when there are no aliases.
export default function KnownAliases({ aliases }: { aliases?: string[] }) {
  if (!aliases?.length) return null;
  return (
    <details style={{ margin: "-8px 0 18px", fontSize: 13.5, color: "#5a6066" }}>
      <summary style={{ cursor: "pointer", fontFamily: "var(--mono)", fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "#8a8a8a" }}>
        Known aliases ({aliases.length})
      </summary>
      <ul style={{ margin: "8px 0 0", paddingLeft: 18, lineHeight: 1.6 }}>
        {aliases.map((a) => (
          <li key={a}>{a}</li>
        ))}
      </ul>
    </details>
  );
}
