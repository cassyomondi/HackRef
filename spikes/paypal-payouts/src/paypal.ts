import { identifier, type PayoutConfig } from './config.js';

const BASE = 'https://api-m.sandbox.paypal.com';
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};

export type Outcome = 'REJECTED' | 'DUPLICATE' | 'UNKNOWN';
export class PayPalError extends Error {
  constructor(public outcome: Outcome, public httpStatus?: number, public originalBatchId?: string) {
    super(`PayPal request ${outcome.toLowerCase()}${httpStatus ? ` (HTTP ${httpStatus})` : ''}.`);
  }
}

const itemStatuses = new Set([
  'SUCCESS', 'FAILED', 'PENDING', 'UNCLAIMED', 'RETURNED', 'ONHOLD',
  'BLOCKED', 'REFUNDED', 'REVERSED',
]);
const batchStatuses = new Set(['DENIED', 'PENDING', 'PROCESSING', 'SUCCESS', 'CANCELED']);

export function interpretItemStatus(value: unknown) {
  const status = typeof value === 'string' && itemStatuses.has(value) ? value : 'UNKNOWN';
  return { status, recipientPaid: status === 'SUCCESS' };
}

function itemSummary(value: unknown) {
  const item = object(value);
  return {
    payoutItemId: identifier(item.payout_item_id),
    ...interpretItemStatus(item.transaction_status),
  };
}

// Extract only an identifier from PayPal's duplicate link; never follow supplied URLs.
function originalBatchId(body: Record<string, unknown>): string | undefined {
  const details = Array.isArray(body.details) ? body.details : [];
  const links = [body, ...details].flatMap(entry => {
    const value = object(entry).links;
    return Array.isArray(value) ? value : [];
  });
  for (const entry of links) {
    try {
      const url = new URL(String(object(entry).href));
      if (url.origin !== BASE) continue;
      const match = /^\/v1\/payments\/payouts\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
      const id = identifier(match?.[1]);
      if (id) return id;
    } catch { /* No safe original identifier available. */ }
  }
}

export class PayPalSandbox {
  private token?: string;
  constructor(
    private credentials: { clientId: string; secret: string },
    private fetcher: typeof fetch = fetch,
  ) {}

  private async request(path: string, init: RequestInit, submitting = false) {
    let response: Response;
    let body: Record<string, unknown>;
    try {
      response = await this.fetcher(`${BASE}${path}`, {
        ...init, redirect: 'error', signal: AbortSignal.timeout(15_000),
      });
      body = object(await response.json());
    } catch {
      // Do not expose transport errors, request headers, response text, or recipient data.
      throw new PayPalError('UNKNOWN');
    }
    if (!response.ok) {
      const details = Array.isArray(body.details) ? body.details : [];
      const duplicate = body.name === 'DUPLICATE_BATCH_ID'
        || details.some(detail => object(detail).issue === 'DUPLICATE_BATCH_ID');
      const uncertain = submitting && (response.status >= 500 || response.status === 408);
      throw new PayPalError(duplicate ? 'DUPLICATE' : uncertain ? 'UNKNOWN' : 'REJECTED',
        response.status, duplicate ? originalBatchId(body) : undefined);
    }
    return body;
  }

  async authenticate(): Promise<void> {
    const basic = Buffer.from(`${this.credentials.clientId}:${this.credentials.secret}`).toString('base64');
    const body = await this.request('/v1/oauth2/token', {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    if (typeof body.access_token !== 'string' || !body.access_token) throw new PayPalError('UNKNOWN');
    this.token = body.access_token;
  }

  private headers() {
    if (!this.token) throw new Error('Authenticate before using the sandbox API.');
    return { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' };
  }

  async submit(config: PayoutConfig) {
    const body = await this.request('/v1/payments/payouts', {
      method: 'POST', headers: this.headers(),
      body: JSON.stringify({
        sender_batch_header: { sender_batch_id: config.senderBatchId, email_subject: 'HackRef sandbox prize test' },
        items: [{
          recipient_type: 'EMAIL', receiver: config.receiver,
          amount: { value: config.amount, currency: 'USD' }, sender_item_id: config.senderItemId,
        }],
      }),
    }, true);
    const batchId = identifier(object(body.batch_header).payout_batch_id);
    if (!batchId) throw new PayPalError('UNKNOWN');
    // Acceptance is not payment. Retrieve item details separately.
    return { batchId, outcome: 'ACCEPTED' as const, recipientPaid: false as const };
  }

  async batch(batchId: string) {
    if (!identifier(batchId)) throw new Error('Invalid payout batch ID.');
    const body = await this.request(`/v1/payments/payouts/${batchId}?page_size=1000`, {
      method: 'GET', headers: this.headers(),
    });
    const status = object(body.batch_header).batch_status;
    return {
      batchId,
      batchStatus: typeof status === 'string' && batchStatuses.has(status) ? status : 'UNKNOWN',
      items: Array.isArray(body.items) ? body.items.map(itemSummary) : [],
    };
  }

  async item(itemId: string) {
    if (!identifier(itemId)) throw new Error('Invalid payout item ID.');
    return itemSummary(await this.request(`/v1/payments/payouts-item/${itemId}`, {
      method: 'GET', headers: this.headers(),
    }));
  }
}
