import { mkdir, open, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { PayoutConfig } from './config.js';
import { PayPalError } from './paypal.js';

export type Receipt = {
  senderBatchId: string;
  senderItemId: string;
  outcome: 'DISPATCHING' | 'ACCEPTED' | 'REJECTED' | 'DUPLICATE' | 'UNKNOWN';
  createdAt: string;
  batchId?: string;
};

export async function readReceipt(path: string): Promise<Receipt | undefined> {
  try { return JSON.parse(await readFile(path, 'utf8')) as Receipt; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new Error('Cannot read dispatch guard. Preserve it and investigate locally.');
  }
}

export async function dispatchOnce(
  path: string,
  config: PayoutConfig,
  submit: (config: PayoutConfig) => Promise<{ batchId: string }>,
): Promise<Receipt> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  let file;
  try { file = await open(path, 'wx', 0o600); }
  catch { throw new Error('Dispatch guard exists or cannot be created. No payout submitted; use verify.'); }
  const receipt: Receipt = {
    senderBatchId: config.senderBatchId, senderItemId: config.senderItemId,
    outcome: 'DISPATCHING', createdAt: new Date().toISOString(),
  };
  try { await file.writeFile(JSON.stringify(receipt)); await file.sync(); }
  finally { await file.close(); }
  try {
    receipt.batchId = (await submit(config)).batchId;
    receipt.outcome = 'ACCEPTED';
  } catch (error) {
    receipt.outcome = error instanceof PayPalError ? error.outcome : 'UNKNOWN';
    if (error instanceof PayPalError) receipt.batchId = error.originalBatchId;
  }
  // Leave the original guard intact if persistence fails after dispatch.
  await writeFile(`${path}.tmp`, JSON.stringify(receipt), { mode: 0o600 });
  await rename(`${path}.tmp`, path);
  return receipt;
}
