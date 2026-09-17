/**
 * Retry a fresh database CONNECTION, once.
 *
 * Hyperdrive occasionally refuses a connection that succeeds moments later — a
 * cold isolate, a hiccup in the origin-side pool. With no retry, a single such
 * blip renders the error boundary, which is why atlas.buspark.io intermittently
 * showed "Something went wrong" and then worked on refresh.
 *
 * Deliberately scoped to CONNECTING, never to running a statement. A query that
 * fails after it reached Postgres is ambiguous: an INSERT may have committed
 * before the socket dropped, and replaying it would apply the write twice. A
 * connect that fails has sent nothing, so retrying it cannot duplicate anything.
 */
export async function connectOnceMore<T>(
  connect: () => Promise<T>,
  onRetry?: (error: unknown) => void,
  delayMs = 150
): Promise<T> {
  try {
    return await connect();
  } catch (error) {
    onRetry?.(error);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return connect();
  }
}

/**
 * Is this statement safe to run twice?
 *
 * Only a plain SELECT is. The question matters because a statement that fails
 * *after* reaching Postgres is ambiguous — an INSERT may have committed before
 * the connection dropped — so replaying a write can apply it twice, while
 * replaying a read cannot do anything but return the same rows.
 *
 * Conservative on purpose: leading comments are stripped, then the statement
 * must BEGIN with SELECT or WITH and contain no data-modifying keyword anywhere.
 * That last check is what makes `WITH x AS (INSERT ... RETURNING *) SELECT ...`
 * — a writing CTE, which looks like a read — fall through to no-retry.
 *
 * Known ceiling: a SELECT calling a VOLATILE function that writes would be
 * misclassified. None exist in this schema; if one is ever added, it must not
 * be reached through query().
 */
export function isReadOnly(sql: string): boolean {
  const stripped = sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .trim();
  if (!/^(select|with)\b/i.test(stripped)) return false;
  return !/\b(insert|update|delete|merge|create|alter|drop|truncate|grant|revoke|call|do)\b/i.test(
    stripped
  );
}
