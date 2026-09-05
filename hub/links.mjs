// THE link list. This is the file to edit when a link changes.
//
// Kept as data rather than hand-written HTML because the handoff asks for it, and
// because 12 cards of near-identical markup is exactly the kind of thing that drifts
// — one card ends up with a stale class or a missing arrow and nobody notices.
// `node build.mjs` renders it to index.html, which is what ships. Users get no JS.

export const TAGLINE =
  "Boston University's tech incubator — student-built products with real-world impact.";

/** Spin duration for the hologram. Handoff says configurable, 4–20s, default 9s. */
export const SPIN_DURATION = "9s";

// Feather-style strokes at 1.8, except the brand marks (GitHub, Discord, LinkedIn,
// Instagram) which use their real filled paths. Taken verbatim from the prototype so
// the icons are the designed ones, not lookalikes.
const S = (d) =>
  `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

export const ICONS = {
  briefcase: S('<path d="M10 7V5a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v2M4 7h16a1 1 0 0 1 1 1v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a1 1 0 0 1 1-1Z M3 12h18"/>'),
  heart: S('<path d="M12 20s-7-4.4-9.3-8.5C.9 8.3 2.7 5 6 5c2 0 3.2 1 4 2.2C10.8 6 12 5 14 5c3.3 0 5.1 3.3 3.3 6.5C15 15.6 12 20 12 20Z"/>'),
  book: S('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4H6.5A2.5 2.5 0 0 0 4 6.5v13ZM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>'),
  coin: S('<circle cx="12" cy="12" r="9"/><path d="M12 7v10M9.5 9.5c0-1 1.1-1.7 2.5-1.7s2.5.7 2.5 1.7-1 1.4-2.5 1.8-2.5.8-2.5 1.8 1.1 1.7 2.5 1.7 2.5-.7 2.5-1.7"/>'),
  userPlus: S('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>'),
  calendar: S('<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4M16 2v4M3 9h18"/>'),
  grid: S('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),
  star: S('<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1L12 2Z"/>'),
  globe: S('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3Z"/>'),
  handshake: S('<path d="M11 17l-1.5 1.5a2.1 2.1 0 0 1-3-3L11 11l2.5 2a2 2 0 0 0 2.7-.1L20 9.5 16.5 6a4 4 0 0 0-5 0L10 7 8.5 6a4 4 0 0 0-5 .5L2 8l4.5 4.5M14 19l2 2M17 16l2 2"/>'),
  github: S('<path fill="currentColor" stroke="none" d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.09.68-.22.68-.49 0-.24-.01-.88-.01-1.73-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.5-1.11-1.5-.91-.63.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.89 1.57 2.34 1.12 2.91.85.09-.66.35-1.11.63-1.37-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.7 0 0 .84-.28 2.75 1.05a9.36 9.36 0 0 1 5 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.4.2 2.44.1 2.7.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.8-4.57 5.06.36.32.68.94.68 1.9 0 1.37-.01 2.47-.01 2.81 0 .27.18.59.69.49A10.25 10.25 0 0 0 22 12.25C22 6.58 17.52 2 12 2Z"/>'),
  discord: S('<path fill="currentColor" stroke="none" d="M19.3 5.3A16.9 16.9 0 0 0 15.1 4l-.2.4c1.5.37 2.9 1.1 3.5 1.6a13.5 13.5 0 0 0-12.8 0c.6-.5 2-1.23 3.5-1.6L8.9 4a16.9 16.9 0 0 0-4.2 1.3C2.3 8.9 1.7 12.4 2 15.9c1.8 1.33 3.6 2.14 5.3 2.67l.86-1.42a10 10 0 0 1-1.66-.8l.4-.3a12 12 0 0 0 10.2 0l.4.3c-.53.32-1.09.58-1.66.8l.86 1.42c1.7-.53 3.5-1.34 5.3-2.67.4-4.1-.68-7.6-2.7-10.6ZM8.7 13.9c-1 0-1.8-.92-1.8-2.05s.78-2.05 1.8-2.05 1.82.92 1.8 2.05c0 1.13-.8 2.05-1.8 2.05Zm6.6 0c-1 0-1.8-.92-1.8-2.05s.78-2.05 1.8-2.05 1.82.92 1.8 2.05c0 1.13-.78 2.05-1.8 2.05Z"/>'),
};

// TODO(links): hrefs are the handoff's realistic placeholders. Swap in real URLs.
// "#" is deliberate and visible rather than a plausible-but-wrong guess.
export const GROUPS = [
  {
    title: "Programs",
    links: [
      { title: "Practicum Projects", desc: "Semester-long builds for real clients — SE, DS, ML, UX", icon: "briefcase", href: "#" },
      { title: "Tech for Social Good", desc: "Civic-tech partnerships with nonprofits & government", icon: "heart", href: "#" },
      { title: "Courses & Co-labs", desc: "XC475, co-taught studios, and micro-credentials", icon: "book", href: "#" },
    ],
  },
  {
    title: "For Students",
    links: [
      // ../bounties/ in this monorepo, live (once Cloudflare routes it) at
      // bounties.buspark.io. hackbu.buspark.io points at the same app's
      // /tracks/hackbu page — see bounties/README.md § Hostnames.
      { title: "The Bounty Board", desc: "Paid challenges — incl. the HackBU × BU IS&T track", icon: "coin", href: "https://bounties.buspark.io", featured: true },
      { title: "Work With Us", desc: "Student jobs: engineers, designers, PMs, ambassadors", icon: "userPlus", href: "#" },
      { title: "Events & Workshops", desc: "Innovation Hours, demo nights, semester kickoffs", icon: "calendar", href: "#" },
    ],
  },
  {
    title: "Our Work",
    links: [
      // The one link with a real destination today: Atlas is this monorepo's
      // project portfolio, live (once deployed) at atlas.buspark.io.
      { title: "Project Portfolio", desc: "Every product students have shipped with Spark!", icon: "grid", href: "https://atlas.buspark.io" },
      { title: "Impact & Stories", desc: "Outcomes, awards, and student spotlights", icon: "star", href: "#" },
      { title: "GitHub", desc: "Open-source code from student teams", icon: "github", href: "https://github.com/BU-Spark" },
    ],
  },
  {
    title: "Connect",
    links: [
      { title: "bu.edu/spark", desc: "Official site — about us, staff, how to partner", icon: "globe", href: "https://www.bu.edu/spark/" },
      { title: "Partner With Spark!", desc: "Bring a project — for companies, labs & nonprofits", icon: "handshake", href: "#" },
      { title: "Community Discord", desc: "Where teams form and questions get answered", icon: "discord", href: "#" },
    ],
  },
];

const S16 = (d) =>
  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

export const SOCIALS = [
  { label: "Instagram", href: "#", svg: S16('<rect x="2.5" y="2.5" width="19" height="19" rx="5"/><circle cx="12" cy="12" r="4.2"/><circle cx="17.3" cy="6.7" r="1" fill="currentColor" stroke="none"/>') },
  { label: "GitHub", href: "https://github.com/BU-Spark", svg: S16('<path fill="currentColor" stroke="none" d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.09.68-.22.68-.49 0-.24-.01-.88-.01-1.73-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.5-1.11-1.5-.91-.63.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.89 1.57 2.34 1.12 2.91.85.09-.66.35-1.11.63-1.37-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.7 0 0 .84-.28 2.75 1.05a9.36 9.36 0 0 1 5 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.4.2 2.44.1 2.7.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.8-4.57 5.06.36.32.68.94.68 1.9 0 1.37-.01 2.47-.01 2.81 0 .27.18.59.69.49A10.25 10.25 0 0 0 22 12.25C22 6.58 17.52 2 12 2Z"/>') },
  { label: "LinkedIn", href: "#", svg: S16('<path fill="currentColor" stroke="none" d="M4.98 3.5A2.49 2.49 0 1 1 0 3.5a2.49 2.49 0 0 1 4.98 0ZM.4 8.1h4.6V23H.4V8.1Zm7.6 0h4.4v2h.06c.6-1.14 2.1-2.35 4.3-2.35 4.6 0 5.45 3.03 5.45 6.97V23h-4.6v-7.2c0-1.72-.03-3.93-2.4-3.93-2.4 0-2.77 1.87-2.77 3.8V23H8V8.1Z"/>') },
  { label: "Newsletter", href: "#", svg: S16('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 6L22 7"/>') },
];
