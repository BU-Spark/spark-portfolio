/**
 * Minimal Mailchimp Marketing v3 client built on `fetch`.
 *
 * Replaces `@mailchimp/mailchimp_marketing`, which cannot be bundled for
 * Cloudflare Workers: it is a Node-oriented wrapper (superagent) that imports
 * bare `querystring`, `http`, `stream` and friends, and externalising them
 * cascades without end. We only ever used four endpoints, so the REST calls are
 * genuinely less code than the dependency was.
 *
 * The exported shape deliberately mirrors the SDK's (`lists.getListMember`,
 * etc.) and its error shape (`err.status`, `err.response.body`) so the API
 * routes did not have to change.
 */

const API_KEY = import.meta.env.MAILCHIMP_API_KEY;
const SERVER_PREFIX = import.meta.env.MAILCHIMP_SERVER_PREFIX;

export const AUDIENCE_ID = import.meta.env.MAILCHIMP_AUDIENCE_ID;

/** Mirrors the SDK's thrown error so existing `catch` blocks keep working. */
class MailchimpError extends Error {
  status: number;
  response: { body: unknown };
  constructor(status: number, body: unknown) {
    super(`Mailchimp responded ${status}`);
    this.name = 'MailchimpError';
    this.status = status;
    this.response = { body };
  }
}

function authHeader(): string {
  // Mailchimp uses HTTP Basic; the username is ignored.
  return 'Basic ' + btoa(`anystring:${API_KEY}`);
}

function base(): string {
  if (!API_KEY || !SERVER_PREFIX) {
    throw new Error('MAILCHIMP_API_KEY / MAILCHIMP_SERVER_PREFIX are not configured');
  }
  return `https://${SERVER_PREFIX}.api.mailchimp.com/3.0`;
}

/** `fields: ['a','b']` -> `?fields=a,b`; everything else passes straight through. */
function toQuery(opts?: Record<string, unknown>): string {
  if (!opts) return '';
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(opts)) {
    if (v === undefined || v === null) continue;
    q.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

async function request(method: string, path: string, body?: unknown, opts?: Record<string, unknown>) {
  const res = await fetch(`${base()}${path}${toQuery(opts)}`, {
    method,
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  // 204 on tag updates, and any empty body — don't try to parse those.
  const text = await res.text();
  const parsed = text ? safeJson(text) : null;

  if (!res.ok) throw new MailchimpError(res.status, parsed ?? text);
  return parsed;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const lists = {
  /** GET /lists/{id}/members/{hash} — throws on 404, which callers treat as "not a member yet". */
  getListMember(listId: string, subscriberHash: string, opts?: Record<string, unknown>) {
    return request('GET', `/lists/${listId}/members/${subscriberHash}`, undefined, opts);
  },

  /** PUT /lists/{id}/members/{hash} — upsert. */
  setListMember(listId: string, subscriberHash: string, body: unknown) {
    return request('PUT', `/lists/${listId}/members/${subscriberHash}`, body);
  },

  /** POST /lists/{id}/members/{hash}/tags — returns 204 with no body. */
  updateListMemberTags(listId: string, subscriberHash: string, body: unknown) {
    return request('POST', `/lists/${listId}/members/${subscriberHash}/tags`, body);
  },

  /** GET /lists/{id}/members */
  getListMembersInfo(listId: string, opts?: Record<string, unknown>) {
    return request('GET', `/lists/${listId}/members`, undefined, opts);
  },
};

export default { lists };
