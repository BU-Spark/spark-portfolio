export const prerender = false;

import type { APIRoute } from 'astro';
import { withDb, rosterFor, slugsWithSignups, allCounts } from '../../../lib/db';
import { verifySlackRequest, ephemeral, parseCommand } from '../../../lib/slack';
import { rateLimit, getClientIp } from '../../../lib/rate-limit';

/**
 * The single Slack entry point: `/spark <subcommand> [args]`
 *
 * One command, many subcommands — per langdon, a full bot rather than a
 * collection of one-offs. Adding a capability means adding one entry to
 * HANDLERS below; it needs no change in the Slack app UI, no re-approval, and
 * signature verification stays in one place.
 *
 * Every reply is ephemeral (see lib/slack.ts). Rosters are student PII.
 */

type Handler = (args: string[], locals: unknown) => Promise<Response>;

const SLUG = /^[a-z0-9][a-z0-9-]*$/;

/** Comma-joined addresses — what a mail client's To: field actually wants. */
async function signups(args: string[], locals: unknown): Promise<Response> {
  const slug = (args[0] ?? '').toLowerCase();

  if (!slug) {
    const available = await withDb(locals, slugsWithSignups);
    if (available.length === 0) return ephemeral('No signups on any bounty yet.');
    return ephemeral(
      `Usage: \`/spark signups <slug>\`\n\nBounties with signups:\n` +
        available.map((a) => `• \`${a.slug}\` — ${a.n}`).join('\n')
    );
  }
  if (!SLUG.test(slug)) return ephemeral(`\`${slug}\` is not a valid bounty slug.`);

  const roster = await withDb(locals, (db) => rosterFor(db, slug));
  if (roster.length === 0) {
    const available = await withDb(locals, slugsWithSignups);
    const hint = available.length
      ? `\n\nWith signups: ${available.map((a) => `\`${a.slug}\``).join(', ')}`
      : '';
    return ephemeral(`No signups for \`${slug}\` yet.${hint}`);
  }

  const emails = roster.map((r) => r.email).join(', ');
  const lft = roster.filter((r) => r.intent === 'looking_for_team').length;
  const names = roster.map((r) => `• ${r.first_name} ${r.last_name} — ${r.email}`).join('\n');

  return ephemeral(
    `*${slug}* — ${roster.length} signed up (${lft} looking for teammates)\n\n` +
      `*Addresses* (copy this line):\n\`\`\`${emails}\`\`\`\n*Who*\n${names}`
  );
}

/** A board-wide overview, so comms can see where interest actually is. */
async function counts(_args: string[], locals: unknown): Promise<Response> {
  const all = await withDb(locals, allCounts);
  const entries = Object.entries(all);
  if (entries.length === 0) return ephemeral('No signups on any bounty yet.');
  return ephemeral(
    '*Signups by bounty*\n' +
      entries
        .sort()
        .map(
          ([slug, c]) =>
            `• \`${slug}\` — ${c.interested} interested, ${c.lookingForTeam} looking for teammates`
        )
        .join('\n')
  );
}

async function help(): Promise<Response> {
  return ephemeral(
    '*Spark bounty board*\n' +
      '• `/spark signups <slug>` — addresses + names for one bounty\n' +
      '• `/spark counts` — signups across every bounty\n' +
      '• `/spark help` — this message\n\n' +
      '_Replies are only visible to you._'
  );
}

const HANDLERS: Record<string, Handler> = {
  signups,
  counts,
  help,
  // Aliases, because people will guess these.
  list: counts,
  who: signups,
};

export const POST: APIRoute = async ({ request, locals }) => {
  // The signature covers the exact bytes Slack sent, so read the raw body
  // first and parse from that same string — re-serialising form data reorders
  // it and the digest will not match.
  const rawBody = await request.text();

  const env = (locals as { runtime?: { env?: Record<string, string> } })?.runtime?.env;
  const signingSecret = env?.SLACK_SIGNING_SECRET ?? import.meta.env.SLACK_SIGNING_SECRET;

  const verified = await verifySlackRequest(request, rawBody, signingSecret);
  if (!verified.ok) {
    // 401, no body: an unverified caller learns nothing about the command.
    console.warn('Rejected Slack request:', verified.reason);
    return new Response(null, { status: 401 });
  }

  // Signed requests are still limited: a leaked signing secret should not
  // become an unmetered roster-export tool.
  const rl = rateLimit(getClientIp(request), { name: 'slack', limit: 20, windowSec: 60 });
  if (!rl.allowed) return ephemeral('Rate limited — try again in a minute.');

  const { sub, args } = parseCommand(new URLSearchParams(rawBody).get('text'));
  const handler = HANDLERS[sub];
  if (!handler) {
    return ephemeral(
      `Unknown subcommand \`${sub}\`. Try \`/spark help\` for what is available.`
    );
  }

  try {
    return await handler(args, locals);
  } catch (err) {
    console.error(`/spark ${sub} failed:`, err);
    return ephemeral("Couldn't reach the database. Try again shortly.");
  }
};
