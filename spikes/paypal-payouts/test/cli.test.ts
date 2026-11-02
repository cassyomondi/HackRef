import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

for (const args of [[], ['execute'], ['execute', '--wrong-flag'], ['verify', '--confirm-sandbox-payout']]) {
  test(`CLI rejects unsupported invocation ${JSON.stringify(args)} without credentials or network`, () => {
    // No environment file is loaded; these invocations fail before authentication.
    const result = spawnSync(process.execPath, [cli, ...args], { env: {}, encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Command stopped/);
  });
}

test('verification without credentials fails safely', () => {
  const result = spawnSync(process.execPath, [cli, 'verify'], { env: {}, encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Command stopped/);
});
