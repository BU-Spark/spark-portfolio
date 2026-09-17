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
