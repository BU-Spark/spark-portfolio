/**
 * A human-readable reason from whatever the mail provider handed back.
 *
 * Deliberately defensive: this runs on a failure path, so it must not throw and
 * must never return something as useless as "[object Object]" — the whole point
 * is that someone reading a badge in the admin UI learns what went wrong.
 */
export function errorText(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const e = error as { message?: unknown; name?: unknown; statusCode?: unknown };
    const parts = [
      typeof e.name === "string" ? e.name : null,
      typeof e.message === "string" ? e.message : null,
    ].filter(Boolean);
    if (parts.length) {
      const code = typeof e.statusCode === "number" ? ` (${e.statusCode})` : "";
      return parts.join(": ") + code;
    }
    try {
      return JSON.stringify(error);
    } catch {
      return "send failed";
    }
  }
  return "send failed";
}
