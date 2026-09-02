import { defineCollection, z } from 'astro:content';
import { TOPICS } from '../lib/spine';

/**
 * Bounty schema.
 *
 * Read `spine/vocabularies.md` before changing anything here. Two fields below
 * (`visibility`, `topic`) are settled program-wide vocabularies copied verbatim
 * — do not re-derive them. `lifecycle` deliberately does NOT reuse the spine's
 * project `status`; see bounties/README.md § "Where this sits in the spine".
 */
const bounties = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    difficulty: z.enum(['Beginner', 'Intermediate', 'Advanced']),
    prize: z.number(),
    deadline: z.union([z.string(), z.date()]).transform((v) =>
      v instanceof Date ? v.toISOString().split('T')[0] : v
    ),
    tags: z.array(z.string()),

    /**
     * A bounty's own lifecycle, which is NOT the spine's project pipeline.
     * A bounty is pre-project: it is an offer that may never be claimed.
     *   open      — accepting submissions
     *   completed — awarded to a winner (this is what hands off to atlas)
     *   closed    — deadline passed with no winner. The spine's project
     *               pipeline has no equivalent, because a project that nobody
     *               ever started is not a project.
     */
    status: z.enum(['open', 'completed', 'closed']),

    /**
     * Which track a bounty belongs to. `hackbu` is the BU IS&T collaboration —
     * one track among several, not the whole board. Related to the spine's
     * `owner_org` (authority) but not identical: a track says who is *offering*
     * the bounty, not who may edit the resulting project record.
     */
    track: z.enum(['hackbu', 'spark', 'partner']).optional().default('hackbu'),
    sponsor: z.string().optional(),

    /**
     * spine/vocabularies.md § visibility — settled, live across 170 projects.
     * Least to most visible. Public reads MUST filter `visibility === 'public'`
     * and never `!== 'hidden'`, which would leak internal bounties to anonymous
     * visitors. Defaults to `public` so existing bounty files keep validating.
     */
    visibility: z
      .enum(['hidden', 'restricted', 'internal', 'public'])
      .optional()
      .default('public'),

    /**
     * spine/vocabularies.md § topic taxonomy — settled 11-term set, one per
     * item. Optional here because a bounty is scoped before its subject is
     * always known, but it should be set before a completed bounty is handed
     * to atlas as a project.
     */
    topic: z.enum(TOPICS).optional(),

    requirements: z
      .array(z.object({ text: z.string(), done: z.boolean().optional().default(false) }))
      .optional(),
    featured: z.boolean().optional().default(false),
    winner: z.string().optional(),
    winnerSubmission: z.string().optional(),
    docLink: z.string().optional(),
    repoLink: z.string().optional(),
    instructionsLink: z.string().optional(),
  }),
});

export const collections = { bounties };
