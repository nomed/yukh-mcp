import { z } from "zod";

export const AUDIT_EVENT_TYPES = [
  "audit.stream_opened.v1",
  "request.accepted.v1",
  "authorization.evaluation_recorded.v1",
  "authorization.decision_recorded.v1",
  "authorization.enforcement_recorded.v1",
  "plan.created.v1",
  "approval.requested.v1",
  "approval.approved.v1",
  "apply.admitted.v1",
  "execution.attempt_reserved.v1",
  "execution.started.v1",
  "execution.completed.v1",
] as const;

export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];
export type AuditClassification = "operational" | "protected" | "restricted";
export type AuditReasonCode =
  | "accepted"
  | "policy_allow"
  | "policy_deny"
  | "enforced"
  | "plan_created"
  | "approval_requested"
  | "approval_approved"
  | "apply_admitted"
  | "attempt_reserved"
  | "provider_started"
  | "effect_observed"
  | "no_effect_proven"
  | "partial_effect"
  | "completion_unknown";

export interface AuditCorrelation {
  readonly trace_ref: string | null;
  readonly request_ref: string | null;
  readonly authorization_request_ref: string | null;
  readonly authorization_decision_ref: string | null;
  readonly plan_ref: string | null;
  readonly approval_ref: string | null;
  readonly execution_ref: string | null;
  readonly verification_ref: string | null;
  readonly rollback_ref: string | null;
}

export interface AuditPayloadByEventType {
  readonly "audit.stream_opened.v1": Readonly<{ genesis_hash: string }>;
  readonly "request.accepted.v1": Readonly<{ request_digest: string }>;
  readonly "authorization.evaluation_recorded.v1": Readonly<{
    request_digest: string;
    attribute_snapshot_ref: string;
    attribute_snapshot_digest: string;
    evaluator_ref: string;
  }>;
  readonly "authorization.decision_recorded.v1": Readonly<{
    request_digest: string;
    decision_digest: string;
    effect: "allow" | "deny";
    basis: "explicit" | "default" | "error" | "indeterminate";
    policy_revision_ref: string;
    policy_digest: string;
  }>;
  readonly "authorization.enforcement_recorded.v1": Readonly<{
    decision_digest: string;
    enforcement_result: "enforced" | "denied";
  }>;
  readonly "plan.created.v1": Readonly<{
    plan_digest: string;
    authorization_decision_digest: string;
    observation_digest: string;
  }>;
  readonly "approval.requested.v1": Readonly<{ plan_digest: string }>;
  readonly "approval.approved.v1": Readonly<{
    plan_digest: string;
    approval_digest: string;
  }>;
  readonly "apply.admitted.v1": Readonly<{
    plan_digest: string;
    fresh_authorization_decision_digest: string;
  }>;
  readonly "execution.attempt_reserved.v1": Readonly<{
    plan_digest: string;
    attempt: number;
  }>;
  readonly "execution.started.v1": Readonly<{
    plan_digest: string;
    attempt: number;
  }>;
  readonly "execution.completed.v1": Readonly<{
    plan_digest: string;
    attempt: number;
    result: "effect_observed" | "no_effect_proven" | "partial_effect" | "completion_unknown";
  }>;
}

interface AuditCandidateShape<T extends AuditEventType> {
  readonly audit_candidate_version: 1;
  readonly event_id: string;
  readonly event_type: T;
  readonly occurred_at: string;
  readonly producer: Readonly<{
    readonly component_ref: string;
    readonly instance_ref: string;
  }>;
  readonly correlation: AuditCorrelation;
  readonly causation: Readonly<{
    readonly parent_event_refs: readonly string[];
  }>;
  readonly subject: Readonly<{
    readonly ref: string;
    readonly kind: "human" | "workload" | "service" | "system";
  }>;
  readonly capability: Readonly<{
    readonly id: string;
    readonly version: string;
    readonly definition_digest: string;
  }>;
  readonly scope: Readonly<{
    readonly resource_kind: string;
    readonly resource_set_ref: string;
    readonly resource_set_digest: string;
    readonly environment_ref: string;
  }>;
  readonly outcome: Readonly<{
    readonly status:
      | "accepted"
      | "allowed"
      | "denied"
      | "created"
      | "requested"
      | "approved"
      | "admitted"
      | "reserved"
      | "started"
      | "completed";
    readonly reason_codes: readonly AuditReasonCode[];
  }>;
  readonly payload: AuditPayloadByEventType[T];
}

export type AuditCandidate<T extends AuditEventType = AuditEventType> = T extends AuditEventType
  ? AuditCandidateShape<T>
  : never;

export interface ProtectedAuditEvent extends Omit<
  AuditCandidateShape<AuditEventType>,
  "audit_candidate_version" | "payload"
> {
  readonly audit_event_version: 1;
  readonly classification: AuditClassification;
  readonly committed_at: string;
  readonly payload: Readonly<{
    readonly schema_ref: string;
    readonly value: AuditPayloadByEventType[AuditEventType];
  }>;
  readonly integrity: Readonly<{
    readonly stream_ref: string;
    readonly sequence: number;
    readonly previous_event_hash: string;
    readonly event_hash: string;
    readonly algorithm: "sha256_chain_v1";
    readonly writer_ref: string;
  }>;
}

export type AuditErrorCode =
  | "audit_candidate_invalid"
  | "audit_causation_invalid"
  | "audit_duplicate_conflict"
  | "audit_integrity_failure"
  | "audit_unavailable";

export class AuditError extends Error {
  constructor(readonly code: AuditErrorCode) {
    super(code);
    this.name = "AuditError";
  }
}

type CorrelationKey = keyof AuditCorrelation;

export interface AuditRegistryEntry {
  readonly classification: AuditClassification;
  readonly durability: "control" | "required_pre_effect" | "required_post_start";
  readonly phase: "audit_control" | "ingress" | "authorization" | "planning" | "approval" | "apply";
  readonly schemaRef: string;
  readonly producers: readonly string[];
  readonly statuses: readonly AuditCandidate["outcome"]["status"][];
  readonly reasonCodes: readonly AuditReasonCode[];
  readonly requiredCorrelation: readonly CorrelationKey[];
  readonly optionalCorrelation: readonly CorrelationKey[];
  readonly requiredParentTypes: readonly AuditEventType[];
  readonly retentionClass: "security_evidence_standard_v1";
  readonly projectionPolicy: "protected_full_v1";
}

const standard = {
  retentionClass: "security_evidence_standard_v1",
  projectionPolicy: "protected_full_v1",
} as const;
const request = ["trace_ref", "request_ref"] as const;
const authorization = [...request, "authorization_request_ref"] as const;
const decision = [...authorization, "authorization_decision_ref"] as const;
const plan = [...decision, "plan_ref"] as const;
const approval = [...plan, "approval_ref"] as const;
const execution = [...plan, "execution_ref"] as const;

export const AUDIT_REGISTRY = {
  "audit.stream_opened.v1": {
    ...standard,
    classification: "operational",
    durability: "control",
    phase: "audit_control",
    schemaRef: "audit.stream_opened.v1",
    producers: ["component.audit-writer"],
    statuses: ["accepted"],
    reasonCodes: ["accepted"],
    requiredCorrelation: [],
    optionalCorrelation: [],
    requiredParentTypes: [],
  },
  "request.accepted.v1": {
    ...standard,
    classification: "protected",
    durability: "required_pre_effect",
    phase: "ingress",
    schemaRef: "audit.request_accepted.v1",
    producers: ["component.gateway"],
    statuses: ["accepted"],
    reasonCodes: ["accepted"],
    requiredCorrelation: request,
    optionalCorrelation: [],
    requiredParentTypes: [],
  },
  "authorization.evaluation_recorded.v1": {
    ...standard,
    classification: "protected",
    durability: "required_pre_effect",
    phase: "authorization",
    schemaRef: "audit.authorization_evaluation.v1",
    producers: ["component.gateway"],
    statuses: ["accepted"],
    reasonCodes: ["accepted"],
    requiredCorrelation: authorization,
    optionalCorrelation: [],
    requiredParentTypes: ["request.accepted.v1"],
  },
  "authorization.decision_recorded.v1": {
    ...standard,
    classification: "protected",
    durability: "required_pre_effect",
    phase: "authorization",
    schemaRef: "audit.authorization_decision.v1",
    producers: ["component.gateway"],
    statuses: ["allowed", "denied"],
    reasonCodes: ["policy_allow", "policy_deny"],
    requiredCorrelation: decision,
    optionalCorrelation: [],
    requiredParentTypes: ["authorization.evaluation_recorded.v1"],
  },
  "authorization.enforcement_recorded.v1": {
    ...standard,
    classification: "protected",
    durability: "required_pre_effect",
    phase: "authorization",
    schemaRef: "audit.authorization_enforcement.v1",
    producers: ["component.gateway"],
    statuses: ["allowed", "denied"],
    reasonCodes: ["enforced", "policy_deny"],
    requiredCorrelation: decision,
    optionalCorrelation: [],
    requiredParentTypes: ["authorization.decision_recorded.v1"],
  },
  "plan.created.v1": {
    ...standard,
    classification: "protected",
    durability: "required_pre_effect",
    phase: "planning",
    schemaRef: "audit.plan_created.v1",
    producers: ["component.gateway"],
    statuses: ["created"],
    reasonCodes: ["plan_created"],
    requiredCorrelation: plan,
    optionalCorrelation: [],
    requiredParentTypes: ["authorization.enforcement_recorded.v1"],
  },
  "approval.requested.v1": {
    ...standard,
    classification: "protected",
    durability: "required_pre_effect",
    phase: "approval",
    schemaRef: "audit.approval_requested.v1",
    producers: ["component.gateway"],
    statuses: ["requested"],
    reasonCodes: ["approval_requested"],
    requiredCorrelation: approval,
    optionalCorrelation: [],
    requiredParentTypes: ["plan.created.v1"],
  },
  "approval.approved.v1": {
    ...standard,
    classification: "protected",
    durability: "required_pre_effect",
    phase: "approval",
    schemaRef: "audit.approval_approved.v1",
    producers: ["component.gateway"],
    statuses: ["approved"],
    reasonCodes: ["approval_approved"],
    requiredCorrelation: approval,
    optionalCorrelation: [],
    requiredParentTypes: ["approval.requested.v1", "plan.created.v1"],
  },
  "apply.admitted.v1": {
    ...standard,
    classification: "protected",
    durability: "required_pre_effect",
    phase: "apply",
    schemaRef: "audit.apply_admitted.v1",
    producers: ["component.gateway"],
    statuses: ["admitted"],
    reasonCodes: ["apply_admitted"],
    requiredCorrelation: execution,
    optionalCorrelation: ["approval_ref"],
    requiredParentTypes: ["authorization.enforcement_recorded.v1", "plan.created.v1"],
  },
  "execution.attempt_reserved.v1": {
    ...standard,
    classification: "protected",
    durability: "required_pre_effect",
    phase: "apply",
    schemaRef: "audit.execution_attempt_reserved.v1",
    producers: ["component.gateway"],
    statuses: ["reserved"],
    reasonCodes: ["attempt_reserved"],
    requiredCorrelation: execution,
    optionalCorrelation: ["approval_ref"],
    requiredParentTypes: ["apply.admitted.v1"],
  },
  "execution.started.v1": {
    ...standard,
    classification: "protected",
    durability: "required_post_start",
    phase: "apply",
    schemaRef: "audit.execution_started.v1",
    producers: ["component.gateway"],
    statuses: ["started"],
    reasonCodes: ["provider_started"],
    requiredCorrelation: execution,
    optionalCorrelation: ["approval_ref"],
    requiredParentTypes: ["execution.attempt_reserved.v1"],
  },
  "execution.completed.v1": {
    ...standard,
    classification: "protected",
    durability: "required_post_start",
    phase: "apply",
    schemaRef: "audit.execution_completed.v1",
    producers: ["component.gateway"],
    statuses: ["completed"],
    reasonCodes: ["effect_observed", "no_effect_proven", "partial_effect", "completion_unknown"],
    requiredCorrelation: execution,
    optionalCorrelation: ["approval_ref"],
    requiredParentTypes: ["execution.started.v1"],
  },
} as const satisfies Record<AuditEventType, AuditRegistryEntry>;

const REF = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/);
const DIGEST = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const REASON = z.enum([
  "accepted",
  "policy_allow",
  "policy_deny",
  "enforced",
  "plan_created",
  "approval_requested",
  "approval_approved",
  "apply_admitted",
  "attempt_reserved",
  "provider_started",
  "effect_observed",
  "no_effect_proven",
  "partial_effect",
  "completion_unknown",
]);
const correlationSchema = z
  .object({
    trace_ref: REF.nullable(),
    request_ref: REF.nullable(),
    authorization_request_ref: REF.nullable(),
    authorization_decision_ref: REF.nullable(),
    plan_ref: REF.nullable(),
    approval_ref: REF.nullable(),
    execution_ref: REF.nullable(),
    verification_ref: REF.nullable(),
    rollback_ref: REF.nullable(),
  })
  .strict();
const candidateSchema = z
  .object({
    audit_candidate_version: z.literal(1),
    event_id: REF,
    event_type: z.enum(AUDIT_EVENT_TYPES),
    occurred_at: z.iso.datetime({ offset: true }).regex(/Z$/),
    producer: z.object({ component_ref: REF, instance_ref: REF }).strict(),
    correlation: correlationSchema,
    causation: z.object({ parent_event_refs: z.array(REF).max(8) }).strict(),
    subject: z
      .object({ ref: REF, kind: z.enum(["human", "workload", "service", "system"]) })
      .strict(),
    capability: z
      .object({
        id: z
          .string()
          .min(3)
          .max(128)
          .regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/),
        version: z
          .string()
          .max(64)
          .regex(/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/),
        definition_digest: DIGEST,
      })
      .strict(),
    scope: z
      .object({
        resource_kind: z
          .string()
          .min(1)
          .max(64)
          .regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/),
        resource_set_ref: REF,
        resource_set_digest: DIGEST,
        environment_ref: REF,
      })
      .strict(),
    outcome: z
      .object({
        status: z.enum([
          "accepted",
          "allowed",
          "denied",
          "created",
          "requested",
          "approved",
          "admitted",
          "reserved",
          "started",
          "completed",
        ]),
        reason_codes: z.array(REASON).min(1).max(4),
      })
      .strict(),
    payload: z.unknown(),
  })
  .strict();

const payloadSchemas = {
  "audit.stream_opened.v1": z.object({ genesis_hash: DIGEST }).strict(),
  "request.accepted.v1": z.object({ request_digest: DIGEST }).strict(),
  "authorization.evaluation_recorded.v1": z
    .object({
      request_digest: DIGEST,
      attribute_snapshot_ref: REF,
      attribute_snapshot_digest: DIGEST,
      evaluator_ref: REF,
    })
    .strict(),
  "authorization.decision_recorded.v1": z
    .object({
      request_digest: DIGEST,
      decision_digest: DIGEST,
      effect: z.enum(["allow", "deny"]),
      basis: z.enum(["explicit", "default", "error", "indeterminate"]),
      policy_revision_ref: REF,
      policy_digest: DIGEST,
    })
    .strict(),
  "authorization.enforcement_recorded.v1": z
    .object({ decision_digest: DIGEST, enforcement_result: z.enum(["enforced", "denied"]) })
    .strict(),
  "plan.created.v1": z
    .object({
      plan_digest: DIGEST,
      authorization_decision_digest: DIGEST,
      observation_digest: DIGEST,
    })
    .strict(),
  "approval.requested.v1": z.object({ plan_digest: DIGEST }).strict(),
  "approval.approved.v1": z.object({ plan_digest: DIGEST, approval_digest: DIGEST }).strict(),
  "apply.admitted.v1": z
    .object({ plan_digest: DIGEST, fresh_authorization_decision_digest: DIGEST })
    .strict(),
  "execution.attempt_reserved.v1": z
    .object({ plan_digest: DIGEST, attempt: z.number().int().min(1).max(16) })
    .strict(),
  "execution.started.v1": z
    .object({ plan_digest: DIGEST, attempt: z.number().int().min(1).max(16) })
    .strict(),
  "execution.completed.v1": z
    .object({
      plan_digest: DIGEST,
      attempt: z.number().int().min(1).max(16),
      result: z.enum([
        "effect_observed",
        "no_effect_proven",
        "partial_effect",
        "completion_unknown",
      ]),
    })
    .strict(),
} as const;

const protectedEventSchema = candidateSchema
  .omit({ audit_candidate_version: true, payload: true })
  .extend({
    audit_event_version: z.literal(1),
    classification: z.enum(["operational", "protected", "restricted"]),
    committed_at: z.iso.datetime({ offset: true }).regex(/Z$/),
    payload: z.object({ schema_ref: REF, value: z.unknown() }).strict(),
    integrity: z
      .object({
        stream_ref: REF,
        sequence: z.number().int().min(0),
        previous_event_hash: DIGEST,
        event_hash: DIGEST,
        algorithm: z.literal("sha256_chain_v1"),
        writer_ref: REF,
      })
      .strict(),
  })
  .strict();

export function requiredParentTypes(candidate: AuditCandidate): readonly AuditEventType[] {
  const registered = AUDIT_REGISTRY[candidate.event_type].requiredParentTypes;
  return candidate.event_type === "apply.admitted.v1" && candidate.correlation.approval_ref !== null
    ? [...registered, "approval.approved.v1"]
    : registered;
}

export function validateAuditCandidate(value: unknown): AuditCandidate {
  const base = candidateSchema.safeParse(value);
  if (!base.success) throw new AuditError("audit_candidate_invalid");
  const entry: AuditRegistryEntry = AUDIT_REGISTRY[base.data.event_type];
  const payload = payloadSchemas[base.data.event_type].safeParse(base.data.payload);
  if (!payload.success) throw new AuditError("audit_candidate_invalid");
  if (
    !entry.producers.includes(base.data.producer.component_ref) ||
    !entry.statuses.includes(base.data.outcome.status) ||
    base.data.outcome.reason_codes.some((code) => !entry.reasonCodes.includes(code)) ||
    new Set(base.data.outcome.reason_codes).size !== base.data.outcome.reason_codes.length
  ) {
    throw new AuditError("audit_candidate_invalid");
  }

  const allowed = new Set<CorrelationKey>([
    ...entry.requiredCorrelation,
    ...entry.optionalCorrelation,
  ]);
  for (const key of Object.keys(base.data.correlation) as CorrelationKey[]) {
    if (
      (entry.requiredCorrelation.includes(key) && base.data.correlation[key] === null) ||
      (!allowed.has(key) && base.data.correlation[key] !== null)
    ) {
      throw new AuditError("audit_candidate_invalid");
    }
  }
  const parsed = { ...base.data, payload: payload.data } as AuditCandidate;
  const parents = requiredParentTypes(parsed);
  if (
    parsed.causation.parent_event_refs.length !== parents.length ||
    new Set(parsed.causation.parent_event_refs).size !== parents.length
  ) {
    throw new AuditError("audit_candidate_invalid");
  }
  if (
    parsed.event_type === "audit.stream_opened.v1" &&
    parsed.payload.genesis_hash !== `sha256:${"0".repeat(64)}`
  ) {
    throw new AuditError("audit_candidate_invalid");
  }
  if (
    (parsed.event_type === "authorization.decision_recorded.v1" &&
      (parsed.outcome.status !== (parsed.payload.effect === "allow" ? "allowed" : "denied") ||
        parsed.outcome.reason_codes[0] !==
          (parsed.payload.effect === "allow" ? "policy_allow" : "policy_deny"))) ||
    (parsed.event_type === "authorization.enforcement_recorded.v1" &&
      (parsed.outcome.status !==
        (parsed.payload.enforcement_result === "enforced" ? "allowed" : "denied") ||
        parsed.outcome.reason_codes[0] !==
          (parsed.payload.enforcement_result === "enforced" ? "enforced" : "policy_deny"))) ||
    (parsed.event_type === "execution.completed.v1" &&
      (parsed.outcome.reason_codes.length !== 1 ||
        parsed.outcome.reason_codes[0] !== parsed.payload.result))
  ) {
    throw new AuditError("audit_candidate_invalid");
  }
  return parsed;
}

export function validateProtectedAuditEvent(value: unknown): ProtectedAuditEvent {
  const envelope = protectedEventSchema.safeParse(value);
  if (!envelope.success) throw new AuditError("audit_integrity_failure");
  const candidate = validateAuditCandidate({
    audit_candidate_version: 1,
    event_id: envelope.data.event_id,
    event_type: envelope.data.event_type,
    occurred_at: envelope.data.occurred_at,
    producer: envelope.data.producer,
    correlation: envelope.data.correlation,
    causation: envelope.data.causation,
    subject: envelope.data.subject,
    capability: envelope.data.capability,
    scope: envelope.data.scope,
    outcome: envelope.data.outcome,
    payload: envelope.data.payload.value,
  });
  const registry = AUDIT_REGISTRY[candidate.event_type];
  if (
    envelope.data.classification !== registry.classification ||
    envelope.data.payload.schema_ref !== registry.schemaRef
  ) {
    throw new AuditError("audit_integrity_failure");
  }
  return envelope.data as ProtectedAuditEvent;
}

export function createAuditCandidate<T extends AuditEventType>(
  candidate: AuditCandidate<T>,
): AuditCandidate<T> {
  return validateAuditCandidate(candidate) as AuditCandidate<T>;
}
