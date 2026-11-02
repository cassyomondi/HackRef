export type PayoutConfig = {
  receiver: string;
  amount: string;
  senderBatchId: string;
  senderItemId: string;
};

export function identifier(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value)
    ? value : undefined;
}

export function credentials(env: NodeJS.ProcessEnv) {
  if (!env.PAYPAL_CLIENT_ID?.trim() || !env.PAYPAL_CLIENT_SECRET?.trim()) {
    throw new Error('Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET locally.');
  }
  return { clientId: env.PAYPAL_CLIENT_ID, secret: env.PAYPAL_CLIENT_SECRET };
}

export function payoutConfig(env: NodeJS.ProcessEnv): PayoutConfig {
  const receiver = env.PAYPAL_SANDBOX_RECIPIENT_EMAIL?.trim();
  const amount = env.PAYPAL_PAYOUT_AMOUNT_USD;
  const senderBatchId = identifier(env.PAYPAL_SENDER_BATCH_ID);
  const senderItemId = identifier(env.PAYPAL_SENDER_ITEM_ID);
  if (!receiver || receiver.length > 127 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(receiver)) {
    throw new Error('Configure a valid sandbox recipient email locally.');
  }
  if (!amount || !/^\d{1,2}\.\d{2}$/.test(amount) || Number(amount) < 0.01 || Number(amount) > 5) {
    throw new Error('PAYPAL_PAYOUT_AMOUNT_USD must be 0.01–5.00 with two decimals.');
  }
  if (!senderBatchId || !senderItemId) {
    throw new Error('Set stable sender batch/item IDs using 1–64 letters, digits, underscores or hyphens.');
  }
  return { receiver, amount, senderBatchId, senderItemId };
}
