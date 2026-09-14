/**
 * Host -> track mapping. Run by `npm test`.
 *
 * The bug this exists to catch is silent: a wrong answer here serves the full
 * board at hackbu.buspark.io, which looks like a working site.
 */
import assert from 'node:assert/strict';
import { trackForHost, shouldServeTrackRoot } from './hostname.ts';

assert.equal(trackForHost('hackbu.buspark.io'), 'hackbu');
assert.equal(trackForHost('HackBU.BUSpark.IO'), 'hackbu', 'Host is case-insensitive');
assert.equal(trackForHost('hackbu.buspark.io:8787'), 'hackbu', 'port must be ignored');
assert.equal(trackForHost('spark.buspark.io'), 'spark');
assert.equal(trackForHost('partner.buspark.io'), 'partner');

assert.equal(trackForHost('bounties.buspark.io'), undefined, 'the board is not a track');
assert.equal(trackForHost('bounties-site.workers.dev'), undefined);
assert.equal(trackForHost(''), undefined);
assert.equal(trackForHost(null), undefined);
assert.equal(trackForHost(undefined), undefined);
// Would be a spoof vector if the check were a substring match rather than the
// first label: an attacker-controlled host must not select a track.
assert.equal(trackForHost('evil-hackbu.example.com'), undefined);
assert.equal(trackForHost('example.com'), undefined);

assert.equal(shouldServeTrackRoot('hackbu.buspark.io', '/'), true);
assert.equal(shouldServeTrackRoot('hackbu.buspark.io', ''), true);
// Only the root is remapped -- deep links and APIs must work under either name.
assert.equal(shouldServeTrackRoot('hackbu.buspark.io', '/bounties/some-slug'), false);
assert.equal(shouldServeTrackRoot('hackbu.buspark.io', '/api/slack/command'), false);
assert.equal(shouldServeTrackRoot('hackbu.buspark.io', '/tracks/hackbu'), false);
assert.equal(shouldServeTrackRoot('bounties.buspark.io', '/'), false, 'the board serves itself');

console.log('  ok   host -> track mapping');
console.log('all passed');
