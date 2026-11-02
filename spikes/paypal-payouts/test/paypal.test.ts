import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PayPalError, PayPalSandbox, interpretItemStatus } from '../src/paypal.js';
import { payoutConfig } from '../src/config.js';

const config = { receiver: 'fixture@personal.example.com', amount: '1.00', senderBatchId: 'fixed-batch', senderItemId: 'fixed-item' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function mockClient(responses: (Response | Error)[]) {
  const requests: { url: string; init?: RequestInit }[] = [];
  const client = new PayPalSandbox({ clientId: 'fixture-client', secret: 'fixture-secret' },
    (async (url, init) => {
      requests.push({ url: String(url), init });
      const next = responses.shift();
      assert.ok(next, 'Unexpected API call');
      if (next instanceof Error) throw next;
      return next;
    }) as typeof fetch);
  return { client, requests };
}
const token = () => json({ access_token: 'fixture-token' });

test('OAuth uses sandbox client credentials; verify calls only token and GET endpoints', async () => {
  const { client, requests } = mockClient([token(), json({ batch_header: { batch_status: 'SUCCESS' }, items: [] }),
    json({ payout_item_id: 'item-1', transaction_status: 'PENDING', payout_item: { receiver: config.receiver } })]);
  await client.authenticate();
  const batch = await client.batch('batch-1');
  const item = await client.item('item-1');
  assert.equal(batch.batchStatus, 'SUCCESS');
  assert.equal(item.recipientPaid, false);
  assert.equal(requests[0]?.url, 'https://api-m.sandbox.paypal.com/v1/oauth2/token');
  assert.equal(requests[0]?.init?.body, 'grant_type=client_credentials');
  assert.equal((requests[0]?.init?.headers as Record<string, string>).Authorization,
    `Basic ${Buffer.from('fixture-client:fixture-secret').toString('base64')}`);
  assert.deepEqual(requests.map(request => request.init?.method), ['POST', 'GET', 'GET']);
  assert.ok(requests.every(request => request.url.startsWith('https://api-m.sandbox.paypal.com/')));
  assert.ok(requests.every(request => request.init?.redirect === 'error'));
  assert.ok(!JSON.stringify(item).includes(config.receiver));
});

test('accepted payout uses configured stable IDs and never reports recipient success', async () => {
  const { client, requests } = mockClient([token(), json({ batch_header: { payout_batch_id: 'batch-1', batch_status: 'SUCCESS' } }, 201)]);
  await client.authenticate();
  assert.deepEqual(await client.submit(config), { batchId: 'batch-1', outcome: 'ACCEPTED', recipientPaid: false });
  const body = JSON.parse(String(requests[1]?.init?.body));
  assert.equal(body.sender_batch_header.sender_batch_id, 'fixed-batch');
  assert.equal(body.items[0].sender_item_id, 'fixed-item');
  assert.equal(body.items[0].amount.currency, 'USD');
  assert.equal(body.items.length, 1);
  assert.equal(requests.length, 2);
});

test('API errors expose only safe classification and HTTP status', async () => {
  const { client } = mockClient([json({ error: 'invalid_client', error_description: 'fixture-secret fixture@personal.example.com' }, 401)]);
  await assert.rejects(client.authenticate(), error => {
    assert.ok(error instanceof PayPalError);
    assert.equal(error.outcome, 'REJECTED');
    assert.equal(error.httpStatus, 401);
    assert.ok(!String(error).includes('fixture-secret'));
    assert.ok(!String(error).includes(config.receiver));
    return true;
  });
});

test('duplicate response captures safe original batch ID without retrying or following link', async () => {
  const { client, requests } = mockClient([token(), json({
    name: 'VALIDATION_ERROR',
    details: [{ issue: 'DUPLICATE_BATCH_ID', links: [{ href: 'https://api-m.sandbox.paypal.com/v1/payments/payouts/original-1' }] }],
  }, 400)]);
  await client.authenticate();
  await assert.rejects(client.submit(config), error => {
    assert.ok(error instanceof PayPalError);
    assert.equal(error.outcome, 'DUPLICATE');
    assert.equal(error.originalBatchId, 'original-1');
    return true;
  });
  assert.equal(requests.length, 2);
});

test('duplicate response never trusts a foreign API link', async () => {
  const { client } = mockClient([token(), json({ name: 'DUPLICATE_BATCH_ID', links: [{ href: 'https://evil.example/v1/payments/payouts/original-1' }] }, 400)]);
  await client.authenticate();
  await assert.rejects(client.submit(config), error => error instanceof PayPalError && error.originalBatchId === undefined);
});

for (const [name, response] of [
  ['timeout', new Error('sensitive transport error')],
  ['HTTP 500', json({ message: 'sensitive provider response' }, 500)],
  ['HTTP 408', json({}, 408)],
  ['unreadable response', new Response('not-json', { status: 201 })],
  ['missing batch ID', json({ batch_header: { batch_status: 'PENDING' } }, 201)],
] as const) {
  test(`submission ${name} is unknown and never retried`, async () => {
    const { client, requests } = mockClient([token(), response]);
    await client.authenticate();
    await assert.rejects(client.submit(config), error => error instanceof PayPalError && error.outcome === 'UNKNOWN');
    assert.equal(requests.length, 2);
  });
}

test('batch success does not imply payment for pending or missing items', async () => {
  const { client } = mockClient([token(), json({ batch_header: { batch_status: 'SUCCESS' }, items: [
    { payout_item_id: 'item-1', transaction_status: 'UNCLAIMED' },
    { payout_item_id: 'item-2' },
  ] })]);
  await client.authenticate();
  const batch = await client.batch('batch-1');
  assert.ok(batch.items.every(item => !item.recipientPaid));
  assert.equal(batch.items[1]?.status, 'UNKNOWN');
});

test('only item SUCCESS establishes observed recipient payment', () => {
  assert.deepEqual(interpretItemStatus('SUCCESS'), { status: 'SUCCESS', recipientPaid: true });
  for (const status of ['PENDING', 'UNCLAIMED', 'ONHOLD', 'BLOCKED', 'FAILED', 'RETURNED', 'REFUNDED', 'REVERSED', 'unexpected', undefined]) {
    assert.equal(interpretItemStatus(status).recipientPaid, false);
  }
});

test('invalid config blocks oversized amounts and missing stable IDs', () => {
  const env = { PAYPAL_SANDBOX_RECIPIENT_EMAIL: config.receiver, PAYPAL_PAYOUT_AMOUNT_USD: '1.00',
    PAYPAL_SENDER_BATCH_ID: config.senderBatchId, PAYPAL_SENDER_ITEM_ID: config.senderItemId };
  assert.deepEqual(payoutConfig(env), config);
  for (const amount of ['0.00', '5.01', '100.00', '1e0', 'NaN']) {
    assert.throws(() => payoutConfig({ ...env, PAYPAL_PAYOUT_AMOUNT_USD: amount }));
  }
  assert.throws(() => payoutConfig({ ...env, PAYPAL_SENDER_BATCH_ID: '' }));
});
