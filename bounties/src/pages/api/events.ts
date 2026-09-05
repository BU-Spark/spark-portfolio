export const prerender = false;

import type { APIRoute } from 'astro';

const EVENTBRITE_ORG_ID = '206780206649';
const EVENTBRITE_TOKEN = import.meta.env.EVENTBRITE_TOKEN || '';

export const GET: APIRoute = async () => {
  if (!EVENTBRITE_TOKEN) {
    return new Response(JSON.stringify({ error: 'Eventbrite token not configured', events: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const res = await fetch(
      `https://www.eventbriteapi.com/v3/organizations/${EVENTBRITE_ORG_ID}/events/?status=live&order_by=start_asc&expand=venue`,
      {
        headers: {
          Authorization: `Bearer ${EVENTBRITE_TOKEN}`,
        },
      }
    );

    if (!res.ok) {
      const text = await res.text();
      console.error('Eventbrite API error:', res.status, text);
      return new Response(JSON.stringify({ error: 'Eventbrite API error', events: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const data = await res.json();
    const events = (data.events || []).map((evt: any) => ({
        title: evt.name?.text || '',
        when: evt.start?.local
          ? new Date(evt.start.local).toLocaleDateString('en-US', {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })
          : '',
        where: evt.venue?.name || evt.venue?.address?.localized_address_display || 'TBD',
        url: evt.url || '',
      }));

    return new Response(JSON.stringify({ events }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Eventbrite fetch error:', err);
    return new Response(JSON.stringify({ error: 'Failed to fetch events', events: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
