import { fileURLToPath } from 'node:url';
import { credentials, payoutConfig } from './config.js';
import { dispatchOnce, readReceipt } from './dispatch.js';
import { PayPalError, PayPalSandbox } from './paypal.js';

// Fixed package-relative guard: changing the working directory or sender IDs cannot bypass it.
const receiptPath = fileURLToPath(new URL('../../.local/dispatch.json', import.meta.url));

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!['verify', 'execute'].includes(command ?? '')
    || (command === 'verify' && args.length)
    || (command === 'execute' && (args.length !== 1 || args[0] !== '--confirm-sandbox-payout'))) {
    throw new Error('Use verify, or execute --confirm-sandbox-payout for an explicitly authorized sandbox transfer.');
  }
  const client = new PayPalSandbox(credentials(process.env));
  const config = command === 'execute' ? payoutConfig(process.env) : undefined;
  await client.authenticate();
  if (config) {
    const receipt = await dispatchOnce(receiptPath, config, value => client.submit(value));
    console.log(JSON.stringify({ ...receipt, recipientPaid: false, instruction: 'Run verify; acceptance does not establish payment.' }, null, 2));
    if (receipt.outcome !== 'ACCEPTED') process.exitCode = 1;
    return;
  }
  console.log('Sandbox OAuth succeeded. This alone does not prove Payouts access.');
  const receipt = await readReceipt(receiptPath);
  const batchId = process.env.PAYPAL_PAYOUT_BATCH_ID || receipt?.batchId;
  const itemId = process.env.PAYPAL_PAYOUT_ITEM_ID;
  if (batchId) console.log(JSON.stringify(await client.batch(batchId), null, 2));
  if (itemId) console.log(JSON.stringify(await client.item(itemId), null, 2));
  if (!batchId && !itemId) {
    console.log('No PayPal lookup ID available. No payout submitted.');
    if (receipt) console.log('A dispatch guard exists. Reconcile in the sandbox dashboard; do not rotate sender IDs or remove the guard.');
  }
}

main().catch(error => {
  // Only our fixed error messages are safe to print; never dump errors or provider bodies.
  console.error(error instanceof PayPalError ? error.message : 'Command stopped. Check local configuration, command arguments, and dispatch guard.');
  process.exitCode = 1;
});
