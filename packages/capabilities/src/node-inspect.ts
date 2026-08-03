import {
  LocalReadProviderError,
  NODE_INSPECT_IMPLEMENTATION_REF,
  type LocalReadNodeProvider,
  type NodeInspectInput,
} from "../../providers/local-read/src/node-inspect.js";
import { validNodeInspectOutput, validNodeInspectRequest } from "./node-inspect-validation.js";

export const nodeInspectDefinition = {
  contract_version: 1,
  capability: {
    id: "node.inspect",
    version: "1.0.0",
    summary: "Inspect bounded metadata for one configured local node path",
    stability: "experimental",
  },
  resource: { kinds: ["node"], cardinality: "one" },
  environment: { required: true },
  operation: { model: "typed", class: "read", effects: ["observe"] },
  input: {
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["path"],
      properties: { path: { type: "string", minLength: 1, maxLength: 512 } },
    },
  },
  output: {
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["source", "observed_at", "freshness_seconds", "entry"],
      properties: {
        source: {
          type: "object",
          additionalProperties: false,
          required: ["node_ref", "relative_path"],
          properties: {
            node_ref: { type: "string", minLength: 1, maxLength: 128 },
            relative_path: { type: "string", minLength: 1, maxLength: 512 },
          },
        },
        observed_at: { type: "string", minLength: 20, maxLength: 64 },
        freshness_seconds: { type: "integer", minimum: 0, maximum: 86_400 },
        entry: {
          type: "object",
          additionalProperties: false,
          required: ["kind", "size_bytes", "modified_at"],
          properties: {
            kind: { type: "string", enum: ["file", "directory"], maxLength: 16 },
            size_bytes: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
            modified_at: { type: "string", minLength: 20, maxLength: 64 },
          },
        },
      },
    },
  },
  risk: { level: "low", data_classes: ["operational_metadata"] },
  mutation: { mode: "none", destructive: false },
  approval: { mode: "never" },
  execution: {
    timeout_ms: 2_000,
    max_attempts: 1,
    concurrency: "per_resource",
    max_input_bytes: 1_024,
    max_output_bytes: 4_096,
  },
  idempotency: { classification: "naturally_idempotent", key: "forbidden" },
  retry: { policy: "safe_before_start_only" },
  verification: {
    mode: "required",
    postconditions: ["resource_identity_matches", "output_schema_valid"],
  },
  rollback: { mode: "not_applicable" },
  errors: { taxonomy_version: 1 },
} as const;

export interface NodeInspectRequest {
  readonly request_version: 1;
  readonly request_id: string;
  readonly capability: { readonly id: "node.inspect"; readonly version: "1.0.0" };
  readonly resource: { readonly kind: "node"; readonly ref: string };
  readonly environment: string;
  readonly input: NodeInspectInput;
  readonly idempotency_key: null;
}

export interface InvocationAuthorization {
  readonly allowed: boolean;
  readonly evidence_ref: string;
}
export type NodeInspectAuthorizer = (
  request: NodeInspectRequest,
) => Promise<InvocationAuthorization>;

class ProviderTimeoutError extends Error {}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new ProviderTimeoutError()), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function capabilityError(
  code:
    | "authorization_denied"
    | "scope_resolution_failed"
    | "schema_validation_failed"
    | "provider_protocol_error"
    | "execution_timeout",
  phase: "authorize" | "resolve" | "validate" | "execute",
) {
  return {
    error_version: 1,
    code,
    phase,
    retry:
      code === "authorization_denied"
        ? "after_policy_change"
        : code === "execution_timeout"
          ? "policy_declared"
          : "after_correction",
    message:
      code === "authorization_denied"
        ? "The request is not authorized"
        : code === "scope_resolution_failed"
          ? "The configured resource could not be resolved"
          : code === "schema_validation_failed"
            ? "The request is invalid"
            : code === "provider_protocol_error"
              ? "The provider returned an invalid result"
              : "The provider invocation timed out",
    diagnostics: [],
  } as const;
}

export function createNodeInspectCapability(options: {
  readonly provider: LocalReadNodeProvider;
  readonly authorize: NodeInspectAuthorizer;
  readonly now?: () => Date;
  readonly providerTimeoutMs?: number;
}) {
  const now = options.now ?? (() => new Date());
  const providerTimeoutMs = options.providerTimeoutMs ?? nodeInspectDefinition.execution.timeout_ms;
  if (
    !Number.isInteger(providerTimeoutMs) ||
    providerTimeoutMs < 1 ||
    providerTimeoutMs > nodeInspectDefinition.execution.timeout_ms
  )
    throw new TypeError("invalid provider timeout");
  return Object.freeze({
    definition: nodeInspectDefinition,
    async invoke(request: NodeInspectRequest) {
      const started = now().toISOString();
      if (!validNodeInspectRequest(request))
        return result(
          request,
          started,
          now().toISOString(),
          [],
          0,
          null,
          "failed",
          capabilityError("schema_validation_failed", "validate"),
        );
      const authorization = await options.authorize(request);
      if (!authorization.allowed)
        return result(
          request,
          started,
          now().toISOString(),
          [authorization.evidence_ref],
          0,
          null,
          "denied",
          capabilityError("authorization_denied", "authorize"),
        );
      try {
        const output = await withTimeout(
          options.provider.inspect(request.resource.ref, request.input),
          providerTimeoutMs,
        );
        if (!validNodeInspectOutput(output))
          return result(
            request,
            started,
            now().toISOString(),
            [authorization.evidence_ref],
            1,
            null,
            "failed",
            capabilityError("provider_protocol_error", "execute"),
          );
        return result(
          request,
          started,
          now().toISOString(),
          [authorization.evidence_ref],
          1,
          output,
          "succeeded",
          null,
        );
      } catch (error) {
        if (error instanceof ProviderTimeoutError)
          return result(
            request,
            started,
            now().toISOString(),
            [authorization.evidence_ref],
            1,
            null,
            "failed",
            capabilityError("execution_timeout", "execute"),
          );
        if (!(error instanceof LocalReadProviderError)) throw error;
        return result(
          request,
          started,
          now().toISOString(),
          [authorization.evidence_ref],
          1,
          null,
          "failed",
          capabilityError("scope_resolution_failed", "resolve"),
        );
      }
    },
  });
}

function result(
  request: NodeInspectRequest,
  started_at: string,
  finished_at: string,
  evidence_refs: readonly string[],
  attempts: 0 | 1,
  output: object | null,
  status: "succeeded" | "denied" | "failed",
  error: object | null,
) {
  return {
    result_version: 1,
    request_id: request.request_id,
    capability: request.capability,
    status,
    resource_ref: request.resource.ref,
    environment: request.environment,
    attempts,
    implementation_ref: NODE_INSPECT_IMPLEMENTATION_REF,
    started_at,
    finished_at,
    output,
    verification: {
      status: status === "succeeded" ? "verified" : "not_applicable",
      evidence_refs,
    },
    error,
  } as const;
}
