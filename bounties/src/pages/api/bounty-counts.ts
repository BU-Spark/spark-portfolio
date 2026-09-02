export const prerender = false;

import type { APIRoute } from 'astro';
import mailchimp, { AUDIENCE_ID } from '../../lib/mailchimp';

export const GET: APIRoute = async ({ url }) => {
  try {
    // Fetch all members once
    let allMembers: any[] = [];
    try {
      const res = await (mailchimp as any).lists.getListMembersInfo(AUDIENCE_ID, {
        count: 1000,
        status: 'subscribed',
        fields: ['members.email_address', 'members.tags'],
      });
      allMembers = res.members || [];
    } catch (e) {
      console.error('Failed to fetch members for counts:', e);
    }

    const slug = url.searchParams.get('slug');

    if (slug) {
      // Single bounty mode (backwards compatible)
      const interested = allMembers.filter((m: any) =>
        (m.tags || []).some((t: any) => t.name === `interested:${slug}`)
      ).length;
      const lookingForTeam = allMembers.filter((m: any) =>
        (m.tags || []).some((t: any) => t.name === `team:${slug}`)
      ).length;

      return new Response(JSON.stringify({ interested, lookingForTeam }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Batch mode: return counts for all bounties
    const counts: Record<string, { interested: number; lookingForTeam: number }> = {};
    for (const m of allMembers) {
      for (const t of (m.tags || [])) {
        const name: string = t.name || '';
        if (name.startsWith('interested:')) {
          const s = name.slice('interested:'.length);
          if (!counts[s]) counts[s] = { interested: 0, lookingForTeam: 0 };
          counts[s].interested++;
        } else if (name.startsWith('team:')) {
          const s = name.slice('team:'.length);
          if (!counts[s]) counts[s] = { interested: 0, lookingForTeam: 0 };
          counts[s].lookingForTeam++;
        }
      }
    }

    return new Response(JSON.stringify(counts), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    const detail = err?.response?.body?.detail || err?.message || String(err);
    console.error('Bounty counts API error:', err?.response?.body || err);
    return new Response(JSON.stringify({ error: 'Internal server error', detail }), { status: 500 });
  }
};
