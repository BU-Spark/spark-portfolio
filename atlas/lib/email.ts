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

const FROM = process.env.EMAIL_FROM || "onboarding@resend.dev";

// Reply-to is a plain header, so it needs no DNS records of its own — the sending
// domain is the only thing that has to be verified. That's what makes it useful
// here: mail leaves from the verified no-reply@buspark.io, but a PM who just hits
// Reply reaches a real monitored inbox instead of a black hole.
const REPLY_TO = process.env.EMAIL_REPLY_TO || "buspark@bu.edu";

export function emailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

/**
 * Best-effort send. Returns { sent: false } (never throws) when Resend isn't
 * configured or the send fails, so the caller always falls back to copy-link.
 */
export async function sendUploadInvite(
  to: string,
  url: string,
  projectTitle: string
): Promise<{ sent: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { sent: false };
  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
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
             expires in 14 days. You can forward it to a teammate. No login required.</p>
        </div>`,
    });
    if (error) return { sent: false, error: String(error) };
    return { sent: true };
  } catch (e) {
    return { sent: false, error: e instanceof Error ? e.message : "send failed" };
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
