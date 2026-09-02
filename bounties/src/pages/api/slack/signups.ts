export const prerender = false;

import type { APIRoute } from 'astro';
import { withDb, rosterFor, slugsWithSignups } from '../../../lib/db';
import { verifySlackRequest, ephemeral } from '../../../lib/slack';
import { rateLimit, getClientIp } from '../../../lib/rate-limit';

/**
 * Slack slash command: `/bounty-signups <slug>`
 *
 * Built for comms, who need an address list to paste into a mail tool and
 * should not need Postgres access or a CSV download to get one.
 *
 * Replies are always ephemeral — see lib/slack.ts. The roster is student PII.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  // The signature is over the exact bytes Slack sent, so read the raw body
  // FIRST and parse it afterwards from that same string.
  const rawBody = await request.text();

  const env = (locals as { runtime?: { env?: Record<string, string> } })?.runtime?.env;
  const signingSecret = env?.SLACK_SIGNING_SECRET ?? import.meta.env.SLACK_SIGNING_SECRET;

  const verified = await verifySlackRequest(request, rawBody, signingSecret);
  if (!verified.ok) {
    // 401 with no body: an unverified caller learns nothing about the command.
    console.warn('Rejected Slack request:', verified.reason);
    return new Response(null, { status: 401 });
  }

  // Verified requests are still rate limited — a signed token that leaks
  // should not become an unmetered roster-export tool.
  const rl = rateLimit(getClientIp(request), { name: 'slack-signups', limit: 20, windowSec: 60 });
  if (!rl.allowed) return ephemeral('Rate limited — try again in a minute.');

  const params = new URLSearchParams(rawBody);
  const slug = (params.get('text') || '').trim().toLowerCase();

  try {
    if (!slug) {
      const available = await withDb(locals, slugsWithSignups);
      if (available.length === 0) return ephemeral('No signups on any bounty yet.');
      const list = available.map((a) => `• \`${a.slug}\` — ${a.n}`).join('\n');
      return ephemeral(`Usage: \`/bounty-signups <slug>\`\n\nBounties with signups:\n${list}`);
    }

    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
      return ephemeral(`\`${slug}\` is not a valid bounty slug.`);
    }

    const roster = await withDb(locals, (db) => rosterFor(db, slug));
    if (roster.length === 0) {
      const available = await withDb(locals, slugsWithSignups);
      const hint = available.length
        ? `\n\nBounties with signups: ${available.map((a) => `\`${a.slug}\``).join(', ')}`
        : '';
      return ephemeral(`No signups for \`${slug}\` yet.${hint}`);
    }

    // Comma-separated addresses are what a mail client's To: field wants, so
    // lead with that block — it is the whole reason this command exists.
    const emails = roster.map((r) => r.email).join(', ');
    const lookingForTeam = roster.filter((r) => r.intent === 'looking_for_team').length;
    const names = roster.map((r) => `• ${r.first_name} ${r.last_name} — ${r.email}`).join('\n');

    return ephemeral(
      `*${slug}* — ${roster.length} signed up (${lookingForTeam} looking for teammates)\n\n` +
        `*Addresses* (copy this line):\n\`\`\`${emails}\`\`\`\n` +
        `*Who*\n${names}`
    );
  } catch (err) {
    console.error('slack/signups failed:', err);
    return ephemeral("Couldn't reach the database. Try again shortly.");
  }
};
