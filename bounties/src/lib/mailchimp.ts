/**
 * Mailchimp, used ONLY as a mailer — never as a database.
 *
 * Postgres is the source of truth for who signed up. This module mirrors that
 * state onto the "Spark! Bounty Board" audience as tags, so comms can pick a
 * tag and hit send without anyone copying a list by hand.
 *
 * The tag vocabulary is NOT new. It is the one already in that account (and
 * documented in hackbu-web/CLAUDE.md), so existing muscle memory keeps working:
 *
 *   interested:<slug>   registered interest
 *   team:<slug>         wants teammates          (intent = looking_for_team)
 *   solo:<slug>         working alone            (working_mode = solo)
 *   has-team:<slug>     already has a team       (working_mode = team)
 *
 * `solo:` / `has-team:` are mutually exclusive, and so are `interested:` /
 * `team:`. Mailchimp cannot express that — tags are independent booleans, which
 * is exactly why it is a bad database. So every write here sets one tag and
 * explicitly CLEARS its opposite. Postgres guarantees the invariant; this keeps
 * Mailchimp from drifting out of it.
 *
 * Deliberately hand-rolled over @mailchimp/mailchimp_marketing: that SDK
 * imports `querystring` as a bare builtin, which Rollup will not bundle for
 * Workers. See astro.config.mjs.
 */
import { createHash } from 'node:crypto';

export interface MailchimpEnv {
  apiKey: string;
  serverPrefix: string;
  audienceId: string;
}

/** Missing config is not an error — it just means "no mailer wired up". */
export function resolveMailchimpEnv(locals?: unknown): MailchimpEnv | null {
  const runtime = (locals as { runtime?: { env?: Record<string, string> } })?.runtime?.env;
  // `import.meta.env` exists under Vite/Astro but is undefined under plain
  // node, which is how scripts/backfill-from-mailchimp.ts imports this — hence
  // the optional chain rather than a direct index.
  const viteEnv = (import.meta as { env?: Record<string, string | undefined> }).env;
  const get = (k: string) =>
    runtime?.[k] ??
    viteEnv?.[k] ??
    (typeof process !== 'undefined' ? process.env?.[k] : undefined);

  const apiKey = get('MAILCHIMP_API_KEY');
  const audienceId = get('MAILCHIMP_AUDIENCE_ID');
  // The datacenter is the suffix of the key itself, so it never needs its own
  // secret — but honour an explicit override if one is set.
  const serverPrefix = get('MAILCHIMP_SERVER_PREFIX') ?? apiKey?.split('-').pop();

  if (!apiKey || !audienceId || !serverPrefix) return null;
  return { apiKey, audienceId, serverPrefix };
}

/** Mailchimp addresses members by the MD5 of the lowercased email. */
export function subscriberHash(email: string): string {
  return createHash('md5').update(email.trim().toLowerCase()).digest('hex');
}

export class MailchimpError extends Error {
  // Written out longhand rather than as constructor parameter properties:
  // those emit runtime code, so `node --experimental-strip-types` (how the
  // self-checks run) rejects them.
  status: number;
  body?: unknown;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = 'MailchimpError';
    this.status = status;
    this.body = body;
  }
}

async function call<T>(
  env: MailchimpEnv,
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`https://${env.serverPrefix}.api.mailchimp.com/3.0${path}`, {
    method,
    headers: {
      // Mailchimp ignores the username; any non-empty string works.
      Authorization: `Basic ${btoa(`anystring:${env.apiKey}`)}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.json().catch(() => undefined);
    throw new MailchimpError(`Mailchimp ${method} ${path} -> ${res.status}`, res.status, detail);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export interface SyncPerson {
  email: string;
  firstName: string;
  lastName: string;
}

export interface SyncState {
  bountySlug: string;
  /** From bounty_interest.intent */
  intent: 'interested' | 'looking_for_team';
  /** From bounty_interest.working_mode */
  workingMode: 'solo' | 'team';
  teamId?: string | null;
  /** Populates the BOUNTY merge field, which templates use in subject lines. */
  bountyTitle?: string;
}

/** The four tags implied by one bounty_interest row, and their opposites. */
export function tagsFor(state: SyncState): { active: string[]; inactive: string[] } {
  const s = state.bountySlug;
  const active: string[] = [`interested:${s}`];
  const inactive: string[] = [];

  if (state.intent === 'looking_for_team') active.push(`team:${s}`);
  else inactive.push(`team:${s}`);

  if (state.workingMode === 'team') {
    active.push(`has-team:${s}`);
    inactive.push(`solo:${s}`);
  } else {
    active.push(`solo:${s}`);
    inactive.push(`has-team:${s}`);
  }

  if (state.teamId) active.push(`team-group:${s}:${state.teamId}`);
  return { active, inactive };
}

/** Every tag this app owns for a bounty — used when clearing a withdrawal. */
export function allTagsForBounty(slug: string, teamId?: string | null): string[] {
  const tags = [`interested:${slug}`, `team:${slug}`, `solo:${slug}`, `has-team:${slug}`];
  if (teamId) tags.push(`team-group:${slug}:${teamId}`);
  return tags;
}

/**
 * Upsert the member and set the tags implied by their Postgres row.
 *
 * `status_if_new: 'subscribed'` — the audience's permission reminder already
 * says "you've opted in to hear from BU Spark!", and signing up for a bounty is
 * that opt-in. Existing members' subscription status is never touched, so an
 * unsubscribe is permanent as far as this code is concerned.
 */
export async function syncInterest(
  env: MailchimpEnv,
  person: SyncPerson,
  state: SyncState
): Promise<void> {
  const hash = subscriberHash(person.email);
  const { active, inactive } = tagsFor(state);

  await call(env, 'PUT', `/lists/${env.audienceId}/members/${hash}`, {
    email_address: person.email.trim().toLowerCase(),
    status_if_new: 'subscribed',
    merge_fields: {
      FNAME: person.firstName,
      LNAME: person.lastName,
      ...(state.bountyTitle ? { BOUNTY: state.bountyTitle } : {}),
    },
  });

  await call(env, 'POST', `/lists/${env.audienceId}/members/${hash}/tags`, {
    tags: [
      ...active.map((name) => ({ name, status: 'active' })),
      ...inactive.map((name) => ({ name, status: 'inactive' })),
    ],
  });
}

/**
 * Clear every tag this app owns for one bounty.
 *
 * Called on withdrawal. Skipping it is how comms end up emailing people who
 * pulled out — the failure mode that made tags-as-database untenable.
 * The member itself is left subscribed: they may still want Spark mail, and
 * deciding otherwise is not this endpoint's call.
 */
export async function clearInterest(
  env: MailchimpEnv,
  email: string,
  bountySlug: string,
  teamId?: string | null
): Promise<void> {
  const hash = subscriberHash(email);
  await call(env, 'POST', `/lists/${env.audienceId}/members/${hash}/tags`, {
    tags: allTagsForBounty(bountySlug, teamId).map((name) => ({ name, status: 'inactive' })),
  });
}

export interface MemberSnapshot {
  email: string;
  firstName: string;
  lastName: string;
  tags: string[];
  status: string;
}

/**
 * Every member, paged. Used by the backfill and the reconcile route.
 * `pages` is the number of GETs made -- each one is a Worker subrequest.
 */
export async function listMembers(
  env: MailchimpEnv
): Promise<{ members: MemberSnapshot[]; pages: number }> {
  const out: MemberSnapshot[] = [];
  const pageSize = 1000;
  let pages = 0;
  for (let offset = 0; ; offset += pageSize) {
    pages++;
    const page = await call<{
      members: {
        email_address: string;
        status: string;
        merge_fields?: { FNAME?: string; LNAME?: string };
        tags?: { name: string }[];
      }[];
      total_items: number;
    }>(
      env,
      'GET',
      `/lists/${env.audienceId}/members?count=${pageSize}&offset=${offset}` +
        `&fields=total_items,members.email_address,members.status,` +
        `members.merge_fields,members.tags`
    );

    for (const m of page.members ?? []) {
      out.push({
        email: m.email_address,
        firstName: m.merge_fields?.FNAME ?? '',
        lastName: m.merge_fields?.LNAME ?? '',
        tags: (m.tags ?? []).map((t) => t.name),
        status: m.status,
      });
    }
    if (out.length >= (page.total_items ?? 0) || (page.members ?? []).length === 0) break;
  }
  return { members: out, pages };
}

/**
 * Parse the legacy tag vocabulary back into rows. Used by the backfill, which
 * has to read state that only ever existed in Mailchimp.
 *
 * Note the one legacy inconsistency: a bare `looking-for-team` tag with no
 * slug. It cannot be attributed to a bounty, so it is reported and skipped
 * rather than guessed at.
 */
export function parseTags(tags: string[]): {
  rows: { bountySlug: string; intent: string; workingMode: string; teamId: string | null }[];
  unattributable: string[];
} {
  const slugs = new Set<string>();
  const unattributable: string[] = [];

  for (const t of tags) {
    const [prefix, slug] = t.split(':');
    if (!slug) {
      if (['interested', 'team', 'solo', 'has-team', 'looking-for-team'].includes(prefix)) {
        unattributable.push(t);
      }
      continue;
    }
    if (['interested', 'team', 'solo', 'has-team', 'team-group'].includes(prefix)) {
      slugs.add(slug);
    }
  }

  const rows = [...slugs].map((slug) => {
    const has = (t: string) => tags.includes(t);
    const group = tags.find((t) => t.startsWith(`team-group:${slug}:`));
    return {
      bountySlug: slug,
      intent: has(`team:${slug}`) ? 'looking_for_team' : 'interested',
      // `has-team:` wins over `solo:` if somehow both are set — a team is the
      // more consequential claim, and Postgres will then hold only one.
      workingMode: has(`has-team:${slug}`) ? 'team' : 'solo',
      teamId: group ? group.split(':')[2] : null,
    };
  });

  return { rows, unattributable };
}

/**
 * Mirror a Postgres write onto Mailchimp WITHOUT blocking the response.
 *
 * Three deliberate properties:
 *  - Postgres has already committed by the time this runs. Mailchimp is a
 *    mirror, so a failure here must never fail the user's request.
 *  - If Mailchimp is not configured, this is a no-op. The board works fine
 *    with no mailer attached; only comms lose the tag.
 *  - `ctx.waitUntil` keeps the Worker alive until the request finishes.
 *    Without it the isolate can be torn down mid-flight and the tag write is
 *    silently lost — which is exactly the drift the reconcile route repairs.
 */
export function mirror(locals: unknown, work: (env: MailchimpEnv) => Promise<void>): void {
  const env = resolveMailchimpEnv(locals);
  if (!env) return;

  const running = work(env).catch((err: unknown) => {
    const detail =
      err instanceof MailchimpError ? `${err.status} ${JSON.stringify(err.body)}` : String(err);
    // Logged, not thrown: reconcile is the repair path, not this request.
    console.error('Mailchimp mirror failed (run reconcile to repair):', detail);
  });

  const ctx = (locals as { runtime?: { ctx?: { waitUntil?: (p: Promise<unknown>) => void } } })
    ?.runtime?.ctx;
  ctx?.waitUntil?.(running);
}

/**
 * Workers Free caps one request at 50 subrequests, and syncInterest makes two
 * (member PUT + tags POST). An unbounded loop over every signup dies past ~25
 * rows -- the same limit that broke Atlas bulk email on 2026-11-05. Every
 * reconcile call stays within SUBREQUEST_BUDGET Mailchimp fetches, leaving
 * headroom under 50 for the database connection.
 */
export const SUBREQUEST_BUDGET = 45;
/** 20 rows x 2 fetches = 40, inside the budget. */
export const RECONCILE_ROWS_PER_CALL = 20;

/**
 * `?after=` keyset cursor: a non-negative integer bounty_interest.id, kept as a
 * string because ids are bigint. Missing -> '0'. Invalid -> null (caller 400s).
 */
export function parseAfter(raw: string | null): string | null {
  if (raw === null || raw === '') return '0';
  return /^\d{1,18}$/.test(raw) ? raw : null;
}

/**
 * Cursor result for one keyset page. `matching` is count(*) OVER () of rows
 * with id > after, i.e. this page plus everything after it.
 */
export function keysetResult(pageIds: string[], matching: number) {
  const remaining = Math.max(0, matching - pageIds.length);
  return { nextAfter: remaining > 0 ? pageIds[pageIds.length - 1] : null, remaining };
}

/**
 * How many clears one prune call may make: the budget minus the list GETs
 * already spent. ponytail: past ~45k members (45 list pages) listing alone
 * exhausts the budget and this returns 0; page the listing itself if that day comes.
 */
export function pruneClearCap(listPages: number): number {
  return Math.max(0, SUBREQUEST_BUDGET - listPages);
}

/**
 * Clear up to `cap` orphans in order. Once a member's clear fails, their later
 * orphans in this call are skipped (and reported) instead of each burning a
 * subrequest on what is almost certainly the same failure.
 * ponytail: failures are not remembered across calls, so a member that always
 * fails is retried first every call; add a skip-list param if that ever stalls prune.
 */
export async function clearOrphans<O extends { email: string }>(
  orphans: O[],
  cap: number,
  clear: (o: O) => Promise<void>
): Promise<{ cleared: number; failed: { orphan: O; error: string }[]; skipped: O[]; remaining: number }> {
  const failedEmails = new Set<string>();
  const failed: { orphan: O; error: string }[] = [];
  const skipped: O[] = [];
  let cleared = 0;
  let attempts = 0;
  let i = 0;
  for (; i < orphans.length && attempts < cap; i++) {
    const o = orphans[i];
    const key = o.email.toLowerCase();
    if (failedEmails.has(key)) {
      skipped.push(o);
      continue;
    }
    attempts++;
    try {
      await clear(o);
      cleared++;
    } catch (err) {
      failedEmails.add(key);
      failed.push({ orphan: o, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { cleared, failed, skipped, remaining: orphans.length - i };
}
