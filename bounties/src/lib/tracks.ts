/**
 * Track metadata. A bounty's `track` says who is offering it — `hackbu` is the
 * BU IS&T collaboration, which is one track on the board rather than the board
 * itself. `variant` picks the badge treatment (see src/styles/site.css).
 *
 * Each track gets a landing page at /tracks/<id>, which is what a track-specific
 * hostname points at (hackbu.buspark.io -> /tracks/hackbu). See README.md
 * § "Hostnames".
 */
export const TRACKS = {
  hackbu: {
    label: 'HackBU · IS&T',
    variant: 'accent',
    sponsor: 'BU IS&T',
    title: 'HackBU',
    heading: 'Build the campus you use.',
    blurb:
      'HackBU is our track with BU Information Services & Technology. These bounties touch real campus systems — the APIs, feeds, and portals BU actually runs — with IS&T engineers on hand as mentors.',
  },
  spark: {
    label: 'Spark!',
    variant: 'neutral',
    sponsor: 'BU Spark!',
    title: 'Spark!',
    heading: 'Work on Spark! itself.',
    blurb:
      'Bounties posted by BU Spark! for our own tools and infrastructure — the sites, pipelines, and data work that keep the program running.',
  },
  partner: {
    label: 'Partner',
    variant: 'outline',
    sponsor: '',
    title: 'Partner projects',
    heading: 'Real clients, real stakes.',
    blurb:
      'Bounties from nonprofits, city offices, and community organisations Spark! works with. Someone outside BU is waiting on the result.',
  },
} as const;

export type TrackId = keyof typeof TRACKS;

export const TRACK_IDS = Object.keys(TRACKS) as TrackId[];

export function track(id: string | undefined) {
  return TRACKS[(id ?? 'hackbu') as TrackId] ?? TRACKS.hackbu;
}
