/**
 * Self-check for the Postgres -> Mailchimp tag mapping.
 *
 *   node --experimental-strip-types src/lib/mailchimp.test.ts
 *
 * These are the rules that decide who receives a bounty email, so the
 * mutual-exclusivity clearing is checked in both directions.
 */
import assert from 'node:assert/strict';
import { tagsFor, allTagsForBounty, parseTags, subscriberHash } from './mailchimp.ts';

const S = 'plate-gallery';
let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    console.error(`  FAIL ${name}\n       ${(e as Error).message.split('\n')[0]}`);
    failed++;
  }
}

// ── subscriber hash ─────────────────────────────────────────────────────────
check('subscriber hash is md5 of the lowercased, trimmed email', () => {
  // Known vector: md5("test@example.com")
  assert.equal(subscriberHash('test@example.com'), '55502f40dc8b7c769880b10874abc9d0');
  assert.equal(subscriberHash('  TEST@Example.COM '), '55502f40dc8b7c769880b10874abc9d0');
});

// ── tagsFor: the four combinations ──────────────────────────────────────────
check('interested + solo -> solo active, has-team cleared, team cleared', () => {
  const { active, inactive } = tagsFor({
    bountySlug: S,
    intent: 'interested',
    workingMode: 'solo',
  });
  assert.deepEqual(active.sort(), [`interested:${S}`, `solo:${S}`].sort());
  assert.deepEqual(inactive.sort(), [`has-team:${S}`, `team:${S}`].sort());
});

check('looking_for_team + team -> team + has-team active, solo cleared', () => {
  const { active, inactive } = tagsFor({
    bountySlug: S,
    intent: 'looking_for_team',
    workingMode: 'team',
  });
  assert.deepEqual(active.sort(), [`interested:${S}`, `team:${S}`, `has-team:${S}`].sort());
  assert.deepEqual(inactive, [`solo:${S}`]);
});

check('every state sets interested: — it is the "is on this bounty" tag', () => {
  for (const intent of ['interested', 'looking_for_team'] as const)
    for (const workingMode of ['solo', 'team'] as const)
      assert.ok(tagsFor({ bountySlug: S, intent, workingMode }).active.includes(`interested:${S}`));
});

check('solo and has-team are never both active, for any input', () => {
  for (const intent of ['interested', 'looking_for_team'] as const)
    for (const workingMode of ['solo', 'team'] as const) {
      const { active } = tagsFor({ bountySlug: S, intent, workingMode });
      assert.ok(!(active.includes(`solo:${S}`) && active.includes(`has-team:${S}`)));
    }
});

check('the opposite tag is always explicitly cleared, never just omitted', () => {
  // Omitting is not enough: a stale tag from a previous state would survive.
  const solo = tagsFor({ bountySlug: S, intent: 'interested', workingMode: 'solo' });
  assert.ok(solo.inactive.includes(`has-team:${S}`));
  const team = tagsFor({ bountySlug: S, intent: 'interested', workingMode: 'team' });
  assert.ok(team.inactive.includes(`solo:${S}`));
});

check('team_id adds a team-group tag; absent team_id adds none', () => {
  const withTeam = tagsFor({
    bountySlug: S,
    intent: 'interested',
    workingMode: 'team',
    teamId: 'abc123',
  });
  assert.ok(withTeam.active.includes(`team-group:${S}:abc123`));
  const without = tagsFor({ bountySlug: S, intent: 'interested', workingMode: 'solo' });
  assert.ok(!without.active.some((t) => t.startsWith('team-group:')));
});

// ── withdrawal clears everything this app owns ──────────────────────────────
check('allTagsForBounty covers every tag tagsFor can produce', () => {
  const produced = new Set<string>();
  for (const intent of ['interested', 'looking_for_team'] as const)
    for (const workingMode of ['solo', 'team'] as const)
      for (const t of tagsFor({ bountySlug: S, intent, workingMode, teamId: 'zz' }).active)
        produced.add(t);
  const cleared = new Set(allTagsForBounty(S, 'zz'));
  for (const t of produced) assert.ok(cleared.has(t), `withdrawal would leave ${t} behind`);
});

check('withdrawal does not touch another bounty’s tags', () => {
  assert.ok(allTagsForBounty(S).every((t) => t.endsWith(S)));
});

// ── parseTags: reading legacy state back out (the backfill) ────────────────
check('parses the real legacy shape into one row per bounty', () => {
  const { rows } = parseTags([
    `interested:${S}`,
    `has-team:${S}`,
    `team-group:${S}:53ca7ef4`,
    'Employee',
  ]);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    bountySlug: S,
    intent: 'interested',
    workingMode: 'team',
    teamId: '53ca7ef4',
  });
});

check('a member on two bounties yields two rows', () => {
  const { rows } = parseTags([`interested:${S}`, `solo:${S}`, 'interested:map-tool']);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.bountySlug).sort(), [S, 'map-tool'].sort());
});

check('the bare legacy `looking-for-team` tag is reported, not guessed at', () => {
  const { rows, unattributable } = parseTags(['looking-for-team']);
  assert.equal(rows.length, 0);
  assert.deepEqual(unattributable, ['looking-for-team']);
});

check('non-bounty tags (Employee, XC475, 219) are ignored', () => {
  const { rows, unattributable } = parseTags(['Employee', 'XC475', '219']);
  assert.equal(rows.length, 0);
  assert.equal(unattributable.length, 0);
});

check('has-team wins if both working-mode tags are somehow set', () => {
  const { rows } = parseTags([`interested:${S}`, `solo:${S}`, `has-team:${S}`]);
  assert.equal(rows[0].workingMode, 'team');
});

check('tagsFor and parseTags round-trip', () => {
  for (const intent of ['interested', 'looking_for_team'] as const)
    for (const workingMode of ['solo', 'team'] as const) {
      const { active } = tagsFor({ bountySlug: S, intent, workingMode, teamId: 'tid' });
      const { rows } = parseTags(active);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].intent, intent);
      assert.equal(rows[0].workingMode, workingMode);
      assert.equal(rows[0].teamId, 'tid');
    }
});

console.log(failed === 0 ? '\nall passed' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
