import { z } from "zod";

const boundedRef = z.string().min(1).max(128);
const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const instant = z.iso.datetime({ offset: true });

const bindingSchema = z
  .object({
    binding_version: z.literal(1),
    operation_ref: boundedRef,
    subject_ref: boundedRef,
    capability_ref: boundedRef,
    resource_set_digest: digest,
    environment_ref: boundedRef,
    plan_digest: digest,
    approval_digest: digest,
  })
  .strict();

export type CoordinationBinding = z.infer<typeof bindingSchema>;

const nonceRequestSchema = z
  .object({
    request_version: z.literal(1),
    binding: bindingSchema,
    nonce: z.string().min(16).max(512),
  })
  .strict();

const leaseAcquireRequestSchema = z
  .object({
    request_version: z.literal(1),
    binding: bindingSchema,
    holder_digest: digest,
    ttl_ms: z.number().int().min(1_000).max(60_000),
  })
  .strict();

const leaseHandleRequestSchema = z
  .object({
    request_version: z.literal(1),
    binding: bindingSchema,
    lease_handle: z.string().min(16).max(2_048),
  })
  .strict();

const leaseRenewRequestSchema = leaseHandleRequestSchema
  .extend({ ttl_ms: z.number().int().min(1_000).max(60_000) })
  .strict();

export type NonceConsumeRequest = z.infer<typeof nonceRequestSchema>;
export type LeaseAcquireRequest = z.infer<typeof leaseAcquireRequestSchema>;
export type LeaseHandleRequest = z.infer<typeof leaseHandleRequestSchema>;
export type LeaseRenewRequest = z.infer<typeof leaseRenewRequestSchema>;

const receiptBase = {
  response_version: z.literal(1),
  operation_ref: boundedRef,
  binding_digest: digest,
  evidence_ref: boundedRef,
} as const;

const nonceReceiptSchema = z
  .object({
    ...receiptBase,
    outcome: z.literal("consumed"),
    consumed_at: instant,
  })
  .strict();

const leaseReceiptSchema = z
  .object({
    ...receiptBase,
    outcome: z.enum(["acquired", "active", "renewed"]),
    lease_ref: boundedRef,
    lease_handle: z.string().min(16).max(2_048),
    fencing_token: z.string().regex(/^[1-9][0-9]{0,39}$/),
    expires_at: instant,
  })
  .strict();

const releaseReceiptSchema = z
  .object({
    ...receiptBase,
    outcome: z.literal("released"),
    lease_ref: boundedRef,
    fencing_token: z.string().regex(/^[1-9][0-9]{0,39}$/),
    released_at: instant,
  })
  .strict();

export type NonceReceipt = z.infer<typeof nonceReceiptSchema>;
export type LeaseReceipt = z.infer<typeof leaseReceiptSchema>;
export type ReleaseReceipt = z.infer<typeof releaseReceiptSchema>;

/**
 * An inert MCP-side port. Implementations may be fakes today; no network,
 * authentication, endpoint, or Coordination client is selected here.
 */
export interface CoordinationConsumerDriver {
  consumeNonce(request: NonceConsumeRequest): Promise<unknown>;
  acquireLease(request: LeaseAcquireRequest): Promise<unknown>;
  inspectLease(request: LeaseHandleRequest): Promise<unknown>;
  renewLease(request: LeaseRenewRequest): Promise<unknown>;
  releaseLease(request: LeaseHandleRequest): Promise<unknown>;
}

export type CoordinationConsumerErrorCode =
  | "coordination_request_invalid"
  | "coordination_unavailable"
  | "coordination_response_invalid"
  | "coordination_binding_mismatch"
  | "coordination_receipt_stale";

export class CoordinationConsumerError extends Error {
  readonly code: CoordinationConsumerErrorCode;

  constructor(code: CoordinationConsumerErrorCode) {
    super(code);
    this.name = "CoordinationConsumerError";
    this.code = code;
  }
}

export interface CoordinationConsumer {
  consumeNonce(request: NonceConsumeRequest): Promise<NonceReceipt>;
  acquireLease(request: LeaseAcquireRequest): Promise<LeaseReceipt>;
  inspectLease(request: LeaseHandleRequest): Promise<LeaseReceipt>;
  renewLease(request: LeaseRenewRequest): Promise<LeaseReceipt>;
  releaseLease(request: LeaseHandleRequest): Promise<ReleaseReceipt>;
}

function assertRequest<T>(schema: z.ZodType<T>, request: unknown): T {
  const parsed = schema.safeParse(request);
  if (!parsed.success) throw new CoordinationConsumerError("coordination_request_invalid");
  return parsed.data;
}

function assertReceipt<T extends { operation_ref: string; binding_digest: string }>(
  schema: z.ZodType<T>,
  value: unknown,
  binding: CoordinationBinding,
  expectedBindingDigest: string,
  now: Date,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new CoordinationConsumerError("coordination_response_invalid");
  if (
    parsed.data.operation_ref !== binding.operation_ref ||
    parsed.data.binding_digest !== expectedBindingDigest
  )
    throw new CoordinationConsumerError("coordination_binding_mismatch");
  if ("expires_at" in parsed.data && Date.parse(String(parsed.data.expires_at)) <= now.getTime())
    throw new CoordinationConsumerError("coordination_receipt_stale");
  return Object.freeze(parsed.data);
}

async function callDriver<T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new CoordinationConsumerError("coordination_unavailable")),
          timeoutMs,
        );
      }),
    ]);
  } catch (error) {
    if (error instanceof CoordinationConsumerError) throw error;
    throw new CoordinationConsumerError("coordination_unavailable");
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function createCoordinationConsumer(options: {
  readonly driver: CoordinationConsumerDriver;
  readonly digestBinding: (binding: CoordinationBinding) => string;
  readonly now?: () => Date;
  readonly driverTimeoutMs?: number;
}): CoordinationConsumer {
  const now = options.now ?? (() => new Date());
  const driverTimeoutMs = options.driverTimeoutMs ?? 500;
  if (!Number.isInteger(driverTimeoutMs) || driverTimeoutMs < 1 || driverTimeoutMs > 2_000)
    throw new TypeError("invalid coordination driver timeout");

  function context(binding: CoordinationBinding) {
    let bindingDigest: string;
    try {
      bindingDigest = options.digestBinding(binding);
    } catch {
      throw new CoordinationConsumerError("coordination_request_invalid");
    }
    if (!digest.safeParse(bindingDigest).success)
      throw new CoordinationConsumerError("coordination_request_invalid");
    const observedAt = now();
    if (Number.isNaN(observedAt.getTime()))
      throw new CoordinationConsumerError("coordination_request_invalid");
    return { bindingDigest, observedAt };
  }

  const consumer: CoordinationConsumer = {
    async consumeNonce(request: NonceConsumeRequest) {
      const valid = assertRequest(nonceRequestSchema, request);
      const { bindingDigest, observedAt } = context(valid.binding);
      const raw = await callDriver(() => options.driver.consumeNonce(valid), driverTimeoutMs);
      return assertReceipt(nonceReceiptSchema, raw, valid.binding, bindingDigest, observedAt);
    },
    async acquireLease(request: LeaseAcquireRequest) {
      const valid = assertRequest(leaseAcquireRequestSchema, request);
      const { bindingDigest, observedAt } = context(valid.binding);
      const raw = await callDriver(() => options.driver.acquireLease(valid), driverTimeoutMs);
      const receipt = assertReceipt(
        leaseReceiptSchema,
        raw,
        valid.binding,
        bindingDigest,
        observedAt,
      );
      if (receipt.outcome !== "acquired")
        throw new CoordinationConsumerError("coordination_response_invalid");
      return receipt;
    },
    async inspectLease(request: LeaseHandleRequest) {
      const valid = assertRequest(leaseHandleRequestSchema, request);
      const { bindingDigest, observedAt } = context(valid.binding);
      const raw = await callDriver(() => options.driver.inspectLease(valid), driverTimeoutMs);
      const receipt = assertReceipt(
        leaseReceiptSchema,
        raw,
        valid.binding,
        bindingDigest,
        observedAt,
      );
      if (receipt.outcome !== "active")
        throw new CoordinationConsumerError("coordination_response_invalid");
      return receipt;
    },
    async renewLease(request: LeaseRenewRequest) {
      const valid = assertRequest(leaseRenewRequestSchema, request);
      const { bindingDigest, observedAt } = context(valid.binding);
      const raw = await callDriver(() => options.driver.renewLease(valid), driverTimeoutMs);
      const receipt = assertReceipt(
        leaseReceiptSchema,
        raw,
        valid.binding,
        bindingDigest,
        observedAt,
      );
      if (receipt.outcome !== "renewed")
        throw new CoordinationConsumerError("coordination_response_invalid");
      return receipt;
    },
    async releaseLease(request: LeaseHandleRequest) {
      const valid = assertRequest(leaseHandleRequestSchema, request);
      const { bindingDigest, observedAt } = context(valid.binding);
      const raw = await callDriver(() => options.driver.releaseLease(valid), driverTimeoutMs);
      return assertReceipt(releaseReceiptSchema, raw, valid.binding, bindingDigest, observedAt);
    },
  };
  return Object.freeze(consumer);
}
