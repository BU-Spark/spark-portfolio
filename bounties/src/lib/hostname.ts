/**
 * Host -> track mapping for the track-specific hostnames.
 *
 * `hackbu.buspark.io/` must serve the HackBU track's landing page rather than
 * the whole board. Nothing else in the app reads the Host header, so this is
 * the only place that decision is made; `src/middleware.ts` is its only caller.
 *
 * Kept as a pure function so it is testable without a request: the failure mode
 * this guards against (a hostname silently serving the wrong page) is invisible
 * in a build and expensive to notice in production.
 */
import { TRACK_IDS, type TrackId } from './tracks.ts';

/**
 * The track a hostname is the front door for, or undefined for the main board.
 *
 * Matches on the FIRST label only (`hackbu.buspark.io` -> `hackbu`), so the
 * preview and staging spellings of the same host work without a second list.
 * Port and case are normalised because `Host` carries both.
 */
export function trackForHost(host: string | null | undefined): TrackId | undefined {
  if (!host) return undefined;
  const first = host.trim().toLowerCase().split(':')[0].split('.')[0];
  return (TRACK_IDS as readonly string[]).includes(first) ? (first as TrackId) : undefined;
}

/**
 * True when this request should be answered with a track page instead of the
 * board. Only the ROOT is remapped: `hackbu.buspark.io/bounties/foo` is still
 * that bounty, not a 404, and every API route keeps working under either name.
 */
export function shouldServeTrackRoot(host: string | null | undefined, pathname: string): boolean {
  return (pathname === '/' || pathname === '') && trackForHost(host) !== undefined;
}
