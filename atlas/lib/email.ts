// Optional email delivery for the screenshot-upload magic link. The app's real
// delivery path is copy-the-link; this is the nicer auto-send that turns on once
// RESEND_API_KEY is set. From-address is env-driven so you can ship against
// Resend's onboarding@resend.dev (testing → your own inbox only) and later point
// EMAIL_FROM at a verified domain (e.g. no-reply@buspark.io) with no code change.
//
// A verified domain is necessary but NOT sufficient: Resend's sandbox sender only
// delivers to the Resend account owner, so an unset EMAIL_FROM means every PM
// invite fails no matter how the domain is configured. And verification only proves
// Resend may send as the domain — it says nothing about whether a given message
// actually landed. Always confirm with a real send to an inbox you can open.
import "server-only";
import { Resend } from "resend";
import { errorText } from "./errorText";

const FROM = process.env.EMAIL_FROM || "onboarding@resend.dev";

// Reply-to is a plain header, so it needs no DNS records of its own — the sending
// domain is the only thing that has to be verified. That's what makes it useful
// here: mail leaves from the verified no-reply@buspark.io, but a PM who just hits
// Reply reaches a real monitored inbox instead of a black hole.
export const REPLY_TO = process.env.EMAIL_REPLY_TO || "buspark@bu.edu";

export function emailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

/**
 * Best-effort send. Returns { sent: false } (never throws) when Resend isn't
 * configured or the send fails, so the caller always falls back to copy-link.
 */
export type Invite = { to: string; url: string; projectTitle: string; expiresAt: string };

function inviteEmail({ to, url, projectTitle, expiresAt }: Invite) {
  // The real date, not "14 days": a re-send reuses the link's original expiry.
  const expires = new Date(expiresAt).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  });
  return {
    from: FROM,
    replyTo: REPLY_TO,
    to,
    subject: `Add screenshots for "${projectTitle}" — BU Spark!`,
    html: `
        <div style="font-family:system-ui,sans-serif;font-size:15px;color:#16191c;line-height:1.5">
          <p>Hi,</p>
          <p>You've been asked to add up to 4 screenshots for the BU Spark! project
             <strong>${escapeHtml(projectTitle)}</strong>.</p>
          <p><a href="${url}" style="display:inline-block;background:#0fa392;color:#fff;
             text-decoration:none;padding:11px 20px;border-radius:7px;font-weight:600">
             Upload screenshots →</a></p>
          <p style="color:#6a6f74;font-size:13px">Or paste this link into your browser:<br>
             <a href="${url}">${url}</a></p>
          <p style="color:#9a9a9a;font-size:12.5px">This link is for this project only and
             expires on ${expires}. You can forward it to a teammate. No login required.</p>
        </div>`,
  };
}

/**
 * Best-effort send. Returns { sent: false } (never throws) when Resend isn't
 * configured or the send fails, so the caller always falls back to copy-link.
 */
export async function sendUploadInvite(
  to: string,
  url: string,
  projectTitle: string,
  expiresAt: string
): Promise<{ sent: boolean; error?: string }> {
  return (await sendUploadInvites([{ to, url, projectTitle, expiresAt }]))[0];
}

// Resend's batch endpoint takes up to 100 messages per call.
const BATCH = 100;

/**
 * Send many invites, one Resend call per 100. One call per message is what broke
 * bulk outreach on 2026-11-05: a Worker request may make only 50 outbound
 * fetches, so message 51 onward failed while the key itself was fine. Results
 * line up with `invites` by index. A batch fails or succeeds as a whole, so a
 * rejected address fails the other messages in its chunk too, with the reason.
 */
export async function sendUploadInvites(
  invites: Invite[]
): Promise<{ sent: boolean; error?: string }[]> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return invites.map(() => ({ sent: false }));
  const resend = new Resend(apiKey);
  const out: { sent: boolean; error?: string }[] = [];
  for (let i = 0; i < invites.length; i += BATCH) {
    const chunk = invites.slice(i, i + BATCH);
    let error: string | undefined;
    try {
      // Resend returns an OBJECT error ({ name, message, statusCode }); String()
      // of it is "[object Object]", which hid the real reason once already.
      const r = await resend.batch.send(chunk.map(inviteEmail));
      if (r.error) error = errorText(r.error);
    } catch (e) {
      error = e instanceof Error ? e.message : "send failed";
    }
    for (const _ of chunk) out.push(error ? { sent: false, error } : { sent: true });
  }
  return out;
}

/**
 * Record each delivered invite, AFTER the mail has gone. A record that fails to
 * save must not turn into a 500: the mail is already out, and an error with no
 * per-row result makes the admin retry and email the same people again. So a
 * failed mark stays `sent: true` with `recordFailed` and a reason.
 */
export async function recordSends<T extends { id: string; title: string; to: string; token: string }>(
  queued: T[],
  sends: { sent: boolean; error?: string }[],
  mark: (token: string, to: string) => Promise<unknown>
): Promise<{ id: string; title: string; to: string; sent: boolean; reason?: string; recordFailed?: boolean }[]> {
  const out = [];
  for (const [i, q] of queued.entries()) {
    const r = sends[i];
    const row = { id: q.id, title: q.title, to: q.to, sent: r.sent, reason: r.sent ? undefined : r.error || "send failed" };
    if (r.sent) {
      try {
        await mark(q.token, q.to);
      } catch (e) {
        // Raw DB text stays server-side; the client only needs to know not to resend.
        console.error("upload invite sent but not recorded", { token: q.token, to: q.to, projectId: q.id, err: errorText(e) });
        out.push({ ...row, recordFailed: true, reason: "sent, but the send record failed to save — do not resend" });
        continue;
      }
    }
    out.push(row);
  }
  return out;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
