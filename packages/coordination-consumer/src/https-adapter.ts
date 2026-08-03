import { createHash } from "node:crypto";
import { inspect } from "node:util";
import { z } from "zod";
import {
  CoordinationConsumerError,
  type CoordinationBinding,
  type CoordinationConsumer,
  type LeaseAcquireRequest,
  type LeaseCapability,
  type LeaseHandleRequest,
  type LeaseRenewRequest,
  type NonceConsumeRequest,
} from "./contract.js";

export const COORDINATION_MEDIA_TYPE = "application/yukh-coordination-primitives+json;version=1";
const MAX_BYTES = 4_096;
const ROUTES = {
  nonce: "/coordination-primitives/v1/nonces:consume",
  acquire: "/coordination-primitives/v1/leases:acquire",
  inspect: "/coordination-primitives/v1/leases:inspect",
  renew: "/coordination-primitives/v1/leases:renew",
  release: "/coordination-primitives/v1/leases:release",
} as const;
const digest = z.string().regex(/^[0-9a-f]{64}$/);
const prefixedDigest = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const expiry = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
const capabilities = new WeakMap<object, string>();

class SecretLeaseCapability implements LeaseCapability {
  readonly kind = "coordination_lease_capability_v1" as const;
  constructor(value: string) {
    capabilities.set(this, value);
    Object.freeze(this);
  }
  toString() {
    return "LeaseCapability{REDACTED}" as const;
  }
  toJSON(): never {
    throw new TypeError("lease capability is not serializable");
  }
  [inspect.custom]() {
    return this.toString();
  }
}

export interface RequestAuthentication {
  readonly credential: string;
  readonly proof: string;
}
export type RequestAuthenticator = (request: {
  readonly method: "POST";
  readonly target: string;
  readonly body_digest: string;
  readonly deadline_ms: number;
}) => Promise<RequestAuthentication>;
export type CoordinationTransport = (target: string, init: RequestInit) => Promise<Response>;

function fail(code: ConstructorParameters<typeof CoordinationConsumerError>[0]): never {
  throw new CoordinationConsumerError(code);
}
function sha(domain: string, value: string) {
  return createHash("sha256").update(domain).update("\0").update(value).digest("hex");
}
function canonical(value: Record<string, unknown>) {
  return JSON.stringify(
    Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
  );
}
function validateBinding(value: CoordinationBinding) {
  const schema = z
    .object({
      binding_version: z.literal(1),
      operation_ref: z.string().min(1).max(128),
      subject_ref: z.string().min(1).max(128),
      capability_ref: z.string().min(1).max(128),
      resource_set_digest: prefixedDigest,
      environment_ref: z.string().min(1).max(128),
      plan_digest: prefixedDigest,
      approval_digest: prefixedDigest,
      epoch: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
      expires_at: expiry,
    })
    .strict();
  const parsed = schema.safeParse(value);
  if (!parsed.success || Date.parse(parsed.data.expires_at) <= Date.now())
    fail("coordination_request_invalid");
  return parsed.data;
}
function scopeDigest(binding: CoordinationBinding) {
  return sha(
    "yukh-mcp:coordination-scope:v1",
    canonical(binding as unknown as Record<string, unknown>),
  );
}
function holderDigest(binding: CoordinationBinding, scope: string) {
  return sha(
    "yukh-mcp:coordination-holder:v1",
    canonical({
      approval_digest: binding.approval_digest,
      operation_ref: binding.operation_ref,
      plan_digest: binding.plan_digest,
      scope_digest: scope,
      subject_ref: binding.subject_ref,
    }),
  );
}
function reveal(value: LeaseCapability) {
  const raw = capabilities.get(value as object);
  if (!raw) fail("coordination_request_invalid");
  return raw;
}

function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted)
    return Promise.reject(new CoordinationConsumerError("coordination_unavailable"));
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(new CoordinationConsumerError("coordination_unavailable"));
    signal.addEventListener("abort", aborted, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", aborted);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", aborted);
        reject(error);
      },
    );
  });
}

async function boundedBody(response: Response) {
  if (response.headers.get("content-type") !== COORDINATION_MEDIA_TYPE)
    fail("coordination_response_invalid");
  if (response.headers.get("cache-control") !== "no-store") fail("coordination_response_invalid");
  const reader = response.body?.getReader();
  if (!reader) fail("coordination_response_invalid");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    length += part.value.byteLength;
    if (length > MAX_BYTES) {
      await reader.cancel();
      fail("coordination_response_invalid");
    }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail("coordination_response_invalid");
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    canonical(parsed as Record<string, unknown>) !== text
  )
    fail("coordination_response_invalid");
  return parsed;
}

const problems = new Map([
  ["unauthenticated", 401],
  ["access_denied", 403],
  ["conflict", 409],
  ["replayed", 409],
  ["stale_fence", 409],
  ["temporarily_unavailable", 503],
  ["invariant_violation", 500],
  ["invalid_request", 400],
]);

function problem(value: unknown, status: number): never {
  const parsed = z
    .object({ code: z.string(), status: z.number(), title: z.string(), type: z.string() })
    .strict()
    .safeParse(value);
  if (
    !parsed.success ||
    problems.get(parsed.data.code) !== status ||
    parsed.data.status !== status ||
    parsed.data.title !== parsed.data.code ||
    parsed.data.type !== `urn:yukh:coordination-primitives:problem:${parsed.data.code}`
  )
    fail("coordination_response_invalid");
  if (parsed.data.code === "conflict") fail("coordination_conflict");
  if (parsed.data.code === "replayed") fail("coordination_replayed");
  if (parsed.data.code === "stale_fence") fail("coordination_stale");
  if (parsed.data.code === "unauthenticated" || parsed.data.code === "access_denied")
    fail("coordination_denied");
  fail("coordination_unavailable");
}

export function createHttpsCoordinationConsumer(options: {
  readonly baseUri: string;
  readonly deadlineMs: number;
  readonly authenticate: RequestAuthenticator;
  readonly transport: CoordinationTransport;
}): CoordinationConsumer {
  let base: URL;
  try {
    base = new URL(options.baseUri);
  } catch {
    throw new TypeError("invalid coordination base URI");
  }
  if (
    base.protocol !== "https:" ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.pathname !== "/" ||
    options.deadlineMs < 1 ||
    options.deadlineMs > 2_000
  )
    throw new TypeError("invalid coordination adapter configuration");

  async function call(
    route: string,
    body: Record<string, unknown>,
    outcomes: readonly string[],
    lease: boolean,
  ) {
    const text = canonical(body);
    if (Buffer.byteLength(text) > MAX_BYTES) fail("coordination_request_invalid");
    const target = new URL(route, base).href;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.deadlineMs);
    try {
      const authentication = await withAbort(
        options.authenticate({
          method: "POST",
          target,
          body_digest: sha("yukh-mcp:coordination-body:v1", text),
          deadline_ms: options.deadlineMs,
        }),
        controller.signal,
      );
      if (
        !z
          .object({ credential: z.string().min(1).max(2048), proof: z.string().min(1).max(2048) })
          .strict()
          .safeParse(authentication).success
      )
        fail("coordination_request_invalid");
      const response = await withAbort(
        options.transport(target, {
          method: "POST",
          redirect: "manual",
          signal: controller.signal,
          headers: {
            accept: COORDINATION_MEDIA_TYPE,
            authorization: authentication.credential,
            "content-type": COORDINATION_MEDIA_TYPE,
            dpop: authentication.proof,
          },
          body: text,
        }),
        controller.signal,
      );
      if (response.redirected || response.type === "opaqueredirect")
        fail("coordination_response_invalid");
      const value = await withAbort(boundedBody(response), controller.signal);
      if (!response.ok) problem(value, response.status);
      if (lease) {
        const parsed = z
          .object({
            specversion: z.literal("1"),
            outcome: z.enum(["acquired", "renewed"]),
            lease_capability: z.string().min(1).max(3800),
            fencing_token: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
            expires_at: expiry,
          })
          .strict()
          .safeParse(value);
        if (!parsed.success || !outcomes.includes(parsed.data.outcome))
          fail("coordination_response_invalid");
        return Object.freeze({
          ...parsed.data,
          lease_capability: new SecretLeaseCapability(parsed.data.lease_capability),
        });
      }
      const parsed = z
        .object({ specversion: z.literal("1"), outcome: z.string() })
        .strict()
        .safeParse(value);
      if (!parsed.success || !outcomes.includes(parsed.data.outcome))
        fail(
          parsed.success && ["replayed"].includes(parsed.data.outcome)
            ? "coordination_replayed"
            : parsed.success && ["expired", "released", "stale"].includes(parsed.data.outcome)
              ? "coordination_stale"
              : "coordination_response_invalid",
        );
      return Object.freeze({ outcome: parsed.data.outcome });
    } catch (error) {
      if (error instanceof CoordinationConsumerError) throw error;
      fail("coordination_unavailable");
    } finally {
      clearTimeout(timer);
    }
  }

  const consumer: CoordinationConsumer = {
    consumeNonce: async (request: NonceConsumeRequest) => {
      const binding = validateBinding(request.binding);
      if (
        request.request_version !== 1 ||
        typeof request.nonce !== "string" ||
        request.nonce.length < 16 ||
        request.nonce.length > 512
      )
        fail("coordination_request_invalid");
      const scope = scopeDigest(binding);
      return (await call(
        ROUTES.nonce,
        {
          epoch: binding.epoch,
          expires_at: binding.expires_at,
          scope_digest: scope,
          value_digest: sha("yukh-mcp:coordination-nonce:v1", request.nonce),
        },
        ["consumed"],
        false,
      )) as { outcome: "consumed" };
    },
    acquireLease: async (request: LeaseAcquireRequest) => {
      const binding = validateBinding(request.binding);
      if (request.request_version !== 1) fail("coordination_request_invalid");
      const scope = scopeDigest(binding);
      const result = (await call(
        ROUTES.acquire,
        {
          epoch: binding.epoch,
          expires_at: binding.expires_at,
          holder_digest: holderDigest(binding, scope),
          scope_digest: scope,
        },
        ["acquired"],
        true,
      )) as unknown as { expires_at: string };
      if (Date.parse(result.expires_at) > Date.parse(binding.expires_at))
        fail("coordination_response_invalid");
      return result as never;
    },
    inspectLease: async (request: LeaseHandleRequest) => {
      validateBinding(request.binding);
      if (request.request_version !== 1) fail("coordination_request_invalid");
      return (await call(
        ROUTES.inspect,
        { lease_capability: reveal(request.lease_capability) },
        ["valid"],
        false,
      )) as { outcome: "valid" };
    },
    renewLease: async (request: LeaseRenewRequest) => {
      const binding = validateBinding(request.binding);
      if (
        request.request_version !== 1 ||
        !expiry.safeParse(request.expires_at).success ||
        Date.parse(request.expires_at) <= Date.now() ||
        Date.parse(request.expires_at) > Date.parse(binding.expires_at)
      )
        fail("coordination_request_invalid");
      const result = (await call(
        ROUTES.renew,
        { expires_at: request.expires_at, lease_capability: reveal(request.lease_capability) },
        ["renewed"],
        true,
      )) as unknown as { expires_at: string };
      if (Date.parse(result.expires_at) > Date.parse(request.expires_at))
        fail("coordination_response_invalid");
      return result as never;
    },
    releaseLease: async (request: LeaseHandleRequest) => {
      validateBinding(request.binding);
      if (request.request_version !== 1) fail("coordination_request_invalid");
      return (await call(
        ROUTES.release,
        { lease_capability: reveal(request.lease_capability) },
        ["released"],
        false,
      )) as { outcome: "released" };
    },
  };
  return Object.freeze(consumer);
}
