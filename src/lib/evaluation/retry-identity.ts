import { AI_PIPELINE_VERSION } from "./versions";

export const MAX_MANUAL_RETRIES = 3;
const prefix = `${AI_PIPELINE_VERSION}:manual-retry:`;
const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const identity = new RegExp(`^${prefix}(${uuid}):([1-9][0-9]*):(${uuid})$`);

// The unique durable queue key is also the immutable retry lineage. Unlike
// result JSON, it survives worker claims, failures and successful publication.
export function retryIdentity(key: string) {
  const match = identity.exec(key);
  return match && Number(match[2]) <= MAX_MANUAL_RETRIES
    ? { rootJobId: match[1], number: Number(match[2]), parentJobId: match[3] } : null;
}

export function retryKey(rootJobId: string, number: number, parentJobId: string) {
  const key = `${prefix}${rootJobId}:${number}:${parentJobId}`;
  if (!retryIdentity(key)) throw new Error("Invalid manual retry identity.");
  return key;
}
