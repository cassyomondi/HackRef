import { z } from "zod";
import { approvalInput } from "./awards-validation";

export const paypalId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export const sandboxSendInput = approvalInput.extend({
  approvalId: z.uuid(),
  environment: z.literal("sandbox"),
  confirmSandboxRecipient: z.literal(true),
  confirmSandboxPayout: z.literal(true),
}).strict();
export const reconciliationInput = z.object({
  // An operator can recover an unknown delivery by looking up its original
  // batch. It is persisted only after full batch AND item correlation.
  batchId: paypalId.optional(),
}).strict();
