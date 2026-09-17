import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
// Opt-in: runs real Jev inference only when a Gateway key is present. Provider charges apply.
const key = process.env.AI_GATEWAY_API_KEY?.trim();
test('live sample evaluation returns model decisions', { skip: key ? false : 'AI_GATEWAY_API_KEY not set' }, () => {
  const r = spawnSync(process.execPath, ['dist/cli.js', '--live', '--sample', '--json'], { encoding: 'utf8', timeout: 60_000 });
  assert.equal(r.status, 0, r.stderr);
  const rows = r.stdout.trim().split('\n').map(JSON.parse);
  assert.equal(rows.length, 4);
  assert.ok(rows.every(row => row.mode === 'live'));
  assert.equal(rows[2].reason, 'protected');
  for (const row of [rows[0], rows[1], rows[3]]) {
    assert.ok(['model', 'uncertain'].includes(row.reason), JSON.stringify(row));
    assert.ok(row.actionableProbability >= 0 && row.actionableProbability <= 1);
  }
  assert.match(r.stderr, /Jev calls/);
});
