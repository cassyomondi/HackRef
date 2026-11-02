import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dispatchOnce, readReceipt } from '../src/dispatch.js';
import { PayPalError } from '../src/paypal.js';

const config = { receiver: 'fixture@personal.example.com', amount: '1.00', senderBatchId: 'stable-batch', senderItemId: 'stable-item' };

for (const outcome of ['ACCEPTED', 'UNKNOWN', 'DUPLICATE', 'REJECTED'] as const) {
  test(`persists ${outcome} and prevents repeat dispatch even with changed IDs`, async t => {
    const dir = await mkdtemp(join(tmpdir(), 'hackref-payout-test-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const path = join(dir, 'dispatch.json');
    let calls = 0;
    const submit = async () => {
      calls++;
      assert.equal((await readReceipt(path))?.outcome, 'DISPATCHING');
      if (outcome !== 'ACCEPTED') throw new PayPalError(outcome, 400, outcome === 'DUPLICATE' ? 'original-1' : undefined);
      return { batchId: 'batch-1' };
    };
    assert.equal((await dispatchOnce(path, config, submit)).outcome, outcome);
    await assert.rejects(dispatchOnce(path, { ...config, senderBatchId: 'new-batch', senderItemId: 'new-item' }, submit));
    assert.equal(calls, 1);
    const receipt = await readReceipt(path);
    assert.ok(!JSON.stringify(receipt).includes(config.receiver));
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    if (outcome === 'DUPLICATE') assert.equal(receipt?.batchId, 'original-1');
  });
}

test('concurrent execution submits at most once', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'hackref-payout-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let calls = 0;
  const submit = async () => { calls++; return { batchId: 'batch-1' }; };
  const results = await Promise.allSettled([
    dispatchOnce(join(dir, 'dispatch.json'), config, submit),
    dispatchOnce(join(dir, 'dispatch.json'), config, submit),
  ]);
  assert.equal(calls, 1);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
});

test('crashed or corrupt guard prevents dispatch', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'hackref-payout-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'dispatch.json');
  await writeFile(path, 'partial-write');
  await assert.rejects(readReceipt(path));
  await assert.rejects(dispatchOnce(path, config, async () => { assert.fail('Must not dispatch'); }));
});
