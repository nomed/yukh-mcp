import { createHash } from "node:crypto";
import { z } from "zod";
import { isValidAuditTimestamp, isValidSha256Digest } from "../../audit/src/contract.js";
import { canonicalAuditJson } from "../../audit/src/writer.js";

export type Immutable<T> = T extends string | number | boolean | null
  ? T
  : T extends readonly (infer Item)[]
    ? readonly Immutable<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: Immutable<T[Key]> }
      : never;

export type LifecycleRecordKind = "plan" | "approval" | "execution" | "verification" | "rollback";

export type LifecycleContractErrorCode =
  | "lifecycle_record_invalid"
  | "lifecycle_digest_mismatch"
  | "plan_invalidated"
  | "approval_required"
  | "approval_denied";

export class LifecycleContractError extends Error {
  constructor(readonly code: LifecycleContractErrorCode) {
    super(code);
    this.name = "LifecycleContractError";
  }
}

const referenceSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/);
const capabilityIdSchema = z
  .string()
  .min(3)
  .max(128)
  .regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/);
const semanticVersionSchema = z
  .string()
  .max(64)
  .regex(/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/);
const digestSchema = z.string().refine(isValidSha256Digest);
const timestampSchema = z.string().refine(isValidAuditTimestamp);
const effectSchema = z.enum(["create", "update", "delete", "emit"]);
const approvalLevelSchema = z.enum(["standard", "elevated", "destructive"]);
const authenticationStrengthSchema = z.enum([
  "bounded_session",
  "phishing_resistant",
  "workload_attested",
]);
const conditionTypeSchema = z.enum([
  "exact_resource_identity",
  "existence_version",
  "selected_field_digest",
  "dependency_version",
  "capacity_bound",
  "no_conflicting_lease",
]);

const conditionSchema = z
  .object({
    condition_ref: referenceSchema,
    type: conditionTypeSchema,
    expected_digest: digestSchema,
    observation_ref: referenceSchema,
    observed_at: timestampSchema,
    fresh_until: timestampSchema,
    classification: z.enum(["operational", "protected", "restricted"]),
  })
  .strict();

const operationSchema = z
  .object({
    step_id: referenceSchema,
    operation_digest: digestSchema,
    depends_on: z.array(referenceSchema).max(16),
    effect: effectSchema,
    precondition_refs: z.array(referenceSchema).max(64),
    postcondition_refs: z.array(referenceSchema).min(1).max(64),
  })
  .strict();

const capabilityBindingSchema = z
  .object({
    id: capabilityIdSchema,
    version: semanticVersionSchema,
    definition_digest: digestSchema,
  })
  .strict();

export const mutationPlanSchema = z
  .object({
    lifecycle_plan_version: z.literal(1),
    plan_id: referenceSchema,
    plan_digest: digestSchema,
    request: z
      .object({
        request_id: referenceSchema,
        request_digest: digestSchema,
        normalized_input_digest: digestSchema,
      })
      .strict(),
    subject: z
      .object({
        ref: referenceSchema,
        kind: z.enum(["human", "workload"]),
        authentication_context_ref: referenceSchema,
        authentication_context_digest: digestSchema,
        authentication_strength: authenticationStrengthSchema,
      })
      .strict(),
    capability: capabilityBindingSchema.extend({
      operation_class: z.literal("mutate"),
      effects: z.array(effectSchema).min(1).max(5),
      approval_mode: z.enum(["never", "policy", "explicit"]),
    }),
    scope: z
      .object({
        resource_kind: z
          .string()
          .min(1)
          .max(64)
          .regex(/^[a-z][a-z0-9._-]{0,63}$/),
        resource_refs: z.array(referenceSchema).min(1).max(1_000),
        resource_attributes_digest: digestSchema,
        resource_set_ref: referenceSchema,
        resource_set_digest: digestSchema,
        environment_ref: referenceSchema,
        environment_attributes_digest: digestSchema,
      })
      .strict(),
    planning_authorization: z
      .object({
        request_id: referenceSchema,
        request_digest: digestSchema,
        decision_id: referenceSchema,
        decision_digest: digestSchema,
      })
      .strict(),
    policy: z
      .object({
        bundle_ref: referenceSchema,
        revision: z.number().int().min(1).max(2_147_483_647),
        digest: digestSchema,
      })
      .strict(),
    attributes: z
      .object({
        snapshot_ref: referenceSchema,
        digest: digestSchema,
        observed_at: timestampSchema,
      })
      .strict(),
    target_snapshot: z
      .object({
        snapshot_ref: referenceSchema,
        digest: digestSchema,
        observed_at: timestampSchema,
      })
      .strict(),
    planner_ref: referenceSchema,
    operations: z.array(operationSchema).min(1).max(64),
    operation_set_digest: digestSchema,
    preconditions: z.array(conditionSchema).min(1).max(64),
    postconditions: z.array(conditionSchema).min(1).max(64),
    predicted_effects: z
      .array(
        z
          .object({
            effect: effectSchema,
            resource_set_digest: digestSchema,
            destructive: z.boolean(),
            data_classes: z.array(referenceSchema).max(16),
          })
          .strict(),
      )
      .min(1)
      .max(64),
    approval: z
      .object({
        required: z.boolean(),
        level: approvalLevelSchema.nullable(),
      })
      .strict(),
    idempotency: z
      .object({
        classification: z.enum(["naturally_idempotent", "keyed", "non_idempotent"]),
        key_digest: digestSchema.nullable(),
        max_attempts: z.number().int().min(1).max(5),
        retry: z.enum([
          "never",
          "safe_before_start_only",
          "safe_on_declared_transient_before_effect",
          "provider_verified_idempotent",
        ]),
      })
      .strict(),
    timeout_ms: z.number().int().min(1).max(300_000),
    verification: z
      .object({
        profile: z.enum(["declared_postconditions", "independent"]),
        verifier_ref: referenceSchema,
        postcondition_refs: z.array(referenceSchema).min(1).max(64),
      })
      .strict(),
    rollback: z
      .object({
        mode: z.enum(["compensating", "restore", "unavailable"]),
        capability: capabilityBindingSchema.nullable(),
      })
      .strict(),
    rollback_context: z
      .object({
        original_execution_ref: referenceSchema,
        original_execution_digest: digestSchema,
        original_plan_digest: digestSchema,
        observed_state_digest: digestSchema,
      })
      .strict()
      .nullable(),
    created_at: timestampSchema,
    expires_at: timestampSchema,
  })
  .strict();

export type MutationPlanV1 = Immutable<z.infer<typeof mutationPlanSchema>>;

const approvalBindingsSchema = z
  .object({
    request_digest: digestSchema,
    normalized_input_digest: digestSchema,
    planning_authorization_request_digest: digestSchema,
    planning_authorization_decision_digest: digestSchema,
    subject_ref: referenceSchema,
    authentication_context_digest: digestSchema,
    capability_id: capabilityIdSchema,
    capability_version: semanticVersionSchema,
    capability_definition_digest: digestSchema,
    resource_set_digest: digestSchema,
    resource_attributes_digest: digestSchema,
    environment_ref: referenceSchema,
    environment_attributes_digest: digestSchema,
    policy_bundle_ref: referenceSchema,
    policy_revision: z.number().int().min(1).max(2_147_483_647),
    policy_digest: digestSchema,
    attribute_snapshot_digest: digestSchema,
    target_snapshot_digest: digestSchema,
    operation_set_digest: digestSchema,
  })
  .strict();

export const approvalReceiptSchema = z
  .object({
    approval_receipt_version: z.literal(1),
    approval_id: referenceSchema,
    approval_digest: digestSchema,
    decision: z.enum(["approve", "reject"]),
    plan_id: referenceSchema,
    plan_digest: digestSchema,
    actor: z
      .object({
        ref: referenceSchema,
        authentication_context_ref: referenceSchema,
        authentication_context_digest: digestSchema,
        authentication_strength: authenticationStrengthSchema,
      })
      .strict(),
    authority_ref: referenceSchema,
    approval_policy_ref: referenceSchema,
    approval_policy_digest: digestSchema,
    nonce_digest: digestSchema,
    bindings: approvalBindingsSchema,
    required_level: approvalLevelSchema,
    satisfied_level: approvalLevelSchema.nullable(),
    issued_at: timestampSchema,
    expires_at: timestampSchema,
  })
  .strict();

export type ApprovalReceiptV1 = Immutable<z.infer<typeof approvalReceiptSchema>>;

export const STEP_STATES = [
  "not_started",
  "started",
  "effect_observed",
  "no_effect_proven",
  "failed",
  "completion_unknown",
] as const;
export type StepState = (typeof STEP_STATES)[number];
export const AGGREGATE_OUTCOMES = [
  "effect_observed",
  "no_effect_proven",
  "partial_effect",
  "completion_unknown",
] as const;
export type AggregateOutcome = (typeof AGGREGATE_OUTCOMES)[number];

const stepRecordSchema = z
  .object({
    step_id: referenceSchema,
    state: z.enum(STEP_STATES),
    reason_code: z.enum([
      "not_attempted",
      "provider_started",
      "effect_observed",
      "no_effect_proven",
      "provider_failed",
      "outcome_ambiguous",
      "dependency_stopped",
    ]),
    evidence_refs: z.array(referenceSchema).max(8),
  })
  .strict();

export const executionRecordSchema = z
  .object({
    execution_record_version: z.literal(1),
    execution_ref: referenceSchema,
    execution_digest: digestSchema,
    plan_id: referenceSchema,
    plan_digest: digestSchema,
    authorization_request_id: referenceSchema,
    authorization_request_digest: digestSchema,
    authorization_decision_id: referenceSchema,
    authorization_decision_digest: digestSchema,
    approval_id: referenceSchema.nullable(),
    approval_digest: digestSchema.nullable(),
    reservation_ref: referenceSchema,
    reservation_digest: digestSchema,
    attempt: z.number().int().min(1).max(5),
    started_at: timestampSchema,
    completed_at: timestampSchema,
    steps: z.array(stepRecordSchema).min(1).max(64),
    aggregate_outcome: z.enum(AGGREGATE_OUTCOMES),
  })
  .strict();

export type ExecutionRecordV1 = Immutable<z.infer<typeof executionRecordSchema>>;
export type ExecutionStepRecord = ExecutionRecordV1["steps"][number];

const verificationObservationSchema = z
  .object({
    condition_ref: referenceSchema,
    status: z.enum(["verified", "failed", "inconclusive"]),
    observation_digest: digestSchema,
    evidence_ref: referenceSchema,
    observed_at: timestampSchema,
  })
  .strict();

export const verificationRecordSchema = z
  .object({
    verification_record_version: z.literal(1),
    verification_ref: referenceSchema,
    verification_digest: digestSchema,
    execution_ref: referenceSchema,
    execution_digest: digestSchema,
    plan_id: referenceSchema,
    plan_digest: digestSchema,
    verifier_ref: referenceSchema,
    profile: z.enum(["declared_postconditions", "independent"]),
    started_at: timestampSchema,
    completed_at: timestampSchema,
    observations: z.array(verificationObservationSchema).min(1).max(64),
    outcome: z.enum(["verified", "failed", "inconclusive"]),
  })
  .strict();

export type VerificationRecordV1 = Immutable<z.infer<typeof verificationRecordSchema>>;
export type VerificationObservation = VerificationRecordV1["observations"][number];

export const rollbackRecordSchema = z
  .object({
    rollback_record_version: z.literal(1),
    rollback_ref: referenceSchema,
    rollback_digest: digestSchema,
    original_execution_ref: referenceSchema,
    original_execution_digest: digestSchema,
    original_plan_digest: digestSchema,
    observed_state_digest: digestSchema,
    rollback_plan_id: referenceSchema,
    rollback_plan_digest: digestSchema,
    rollback_execution_ref: referenceSchema.nullable(),
    rollback_execution_digest: digestSchema.nullable(),
    status: z.enum(["requested", "admitted", "completed", "failed", "completion_unknown"]),
    requested_at: timestampSchema,
    completed_at: timestampSchema.nullable(),
  })
  .strict();

export type RollbackRecordV1 = Immutable<z.infer<typeof rollbackRecordSchema>>;

function deepFreeze<T>(value: T): Immutable<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value as Immutable<T>;
}

function withoutDigest<T extends object>(value: T, key: keyof T): Omit<T, keyof T> & object {
  const copy = { ...value };
  delete copy[key];
  return copy;
}

export function lifecycleDigest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalAuditJson(value)).digest("hex")}`;
}

function assertDigest<T extends object>(value: T, key: keyof T): void {
  const digest = value[key];
  if (typeof digest !== "string" || lifecycleDigest(withoutDigest(value, key)) !== digest) {
    throw new LifecycleContractError("lifecycle_digest_mismatch");
  }
}

function exactUnique(values: readonly string[]): boolean {
  return values.length === new Set(values).size;
}

function compareTimestamp(left: string, right: string): number {
  const leftMillis = Date.parse(left);
  const rightMillis = Date.parse(right);
  if (!Number.isFinite(leftMillis) || !Number.isFinite(rightMillis)) {
    throw new LifecycleContractError("lifecycle_record_invalid");
  }
  return leftMillis - rightMillis;
}

function assertPlanSemantics(plan: z.infer<typeof mutationPlanSchema>): void {
  assertDigest(plan, "plan_digest");
  if (
    compareTimestamp(plan.created_at, plan.expires_at) >= 0 ||
    compareTimestamp(plan.attributes.observed_at, plan.created_at) > 0 ||
    compareTimestamp(plan.target_snapshot.observed_at, plan.created_at) > 0 ||
    !exactUnique(plan.scope.resource_refs) ||
    [...plan.scope.resource_refs]
      .sort()
      .some((value, index) => value !== plan.scope.resource_refs[index]) ||
    !exactUnique(plan.capability.effects) ||
    [...plan.capability.effects]
      .sort()
      .some((value, index) => value !== plan.capability.effects[index]) ||
    !exactUnique(plan.preconditions.map(({ condition_ref }) => condition_ref)) ||
    !exactUnique(plan.postconditions.map(({ condition_ref }) => condition_ref)) ||
    !exactUnique(plan.operations.map(({ step_id }) => step_id)) ||
    !exactUnique(plan.verification.postcondition_refs)
  ) {
    throw new LifecycleContractError("lifecycle_record_invalid");
  }
  const preconditions = new Set(plan.preconditions.map(({ condition_ref }) => condition_ref));
  const postconditions = new Set(plan.postconditions.map(({ condition_ref }) => condition_ref));
  const previousSteps = new Set<string>();
  for (const operation of plan.operations) {
    assertDigest(operation, "operation_digest");
    if (
      !exactUnique(operation.depends_on) ||
      !exactUnique(operation.precondition_refs) ||
      !exactUnique(operation.postcondition_refs) ||
      operation.depends_on.some((reference) => !previousSteps.has(reference)) ||
      !plan.capability.effects.includes(operation.effect) ||
      operation.precondition_refs.some((reference) => !preconditions.has(reference)) ||
      operation.postcondition_refs.some((reference) => !postconditions.has(reference))
    ) {
      throw new LifecycleContractError("lifecycle_record_invalid");
    }
    previousSteps.add(operation.step_id);
  }
  if (
    lifecycleDigest(plan.operations) !== plan.operation_set_digest ||
    plan.capability.effects.some(
      (effect) => !plan.operations.some((operation) => operation.effect === effect),
    ) ||
    plan.operations.some(
      (operation) =>
        !plan.predicted_effects.some((prediction) => prediction.effect === operation.effect),
    ) ||
    plan.verification.postcondition_refs.length !== plan.postconditions.length ||
    plan.verification.postcondition_refs.some(
      (reference, index) => reference !== plan.postconditions[index]?.condition_ref,
    ) ||
    plan.predicted_effects.some(
      ({ effect, resource_set_digest, data_classes }) =>
        !plan.capability.effects.includes(effect) ||
        resource_set_digest !== plan.scope.resource_set_digest ||
        !exactUnique(data_classes),
    ) ||
    plan.approval.required !== (plan.approval.level !== null) ||
    (plan.capability.approval_mode === "explicit" && !plan.approval.required) ||
    (plan.idempotency.classification === "keyed") !== (plan.idempotency.key_digest !== null) ||
    (plan.idempotency.classification === "non_idempotent" &&
      (plan.idempotency.retry !== "never" || plan.idempotency.max_attempts !== 1)) ||
    (plan.predicted_effects.some(({ destructive }) => destructive) &&
      (plan.capability.approval_mode !== "explicit" ||
        plan.idempotency.retry !== "never" ||
        plan.idempotency.max_attempts !== 1 ||
        plan.approval.level !== "destructive")) ||
    (plan.rollback.mode === "unavailable" &&
      (plan.capability.approval_mode !== "explicit" ||
        plan.idempotency.retry !== "never" ||
        plan.idempotency.max_attempts !== 1 ||
        !plan.approval.required)) ||
    ((plan.rollback.mode === "compensating" || plan.rollback.mode === "restore") &&
      plan.rollback.capability === null) ||
    (plan.rollback.mode === "unavailable" && plan.rollback.capability !== null)
  ) {
    throw new LifecycleContractError("lifecycle_record_invalid");
  }
  for (const condition of [...plan.preconditions, ...plan.postconditions]) {
    if (
      compareTimestamp(condition.observed_at, condition.fresh_until) >= 0 ||
      compareTimestamp(condition.observed_at, plan.created_at) > 0 ||
      compareTimestamp(plan.expires_at, condition.fresh_until) > 0
    ) {
      throw new LifecycleContractError("lifecycle_record_invalid");
    }
  }
}

export function approvalBindingsForPlan(
  plan: MutationPlanV1,
): Immutable<z.infer<typeof approvalBindingsSchema>> {
  return deepFreeze({
    request_digest: plan.request.request_digest,
    normalized_input_digest: plan.request.normalized_input_digest,
    planning_authorization_request_digest: plan.planning_authorization.request_digest,
    planning_authorization_decision_digest: plan.planning_authorization.decision_digest,
    subject_ref: plan.subject.ref,
    authentication_context_digest: plan.subject.authentication_context_digest,
    capability_id: plan.capability.id,
    capability_version: plan.capability.version,
    capability_definition_digest: plan.capability.definition_digest,
    resource_set_digest: plan.scope.resource_set_digest,
    resource_attributes_digest: plan.scope.resource_attributes_digest,
    environment_ref: plan.scope.environment_ref,
    environment_attributes_digest: plan.scope.environment_attributes_digest,
    policy_bundle_ref: plan.policy.bundle_ref,
    policy_revision: plan.policy.revision,
    policy_digest: plan.policy.digest,
    attribute_snapshot_digest: plan.attributes.digest,
    target_snapshot_digest: plan.target_snapshot.digest,
    operation_set_digest: plan.operation_set_digest,
  });
}

export function validateMutationPlan(value: unknown, now?: string): MutationPlanV1 {
  const parsed = mutationPlanSchema.safeParse(value);
  if (!parsed.success) throw new LifecycleContractError("lifecycle_record_invalid");
  assertPlanSemantics(parsed.data);
  if (
    now !== undefined &&
    (compareTimestamp(now, parsed.data.created_at) < 0 ||
      compareTimestamp(now, parsed.data.expires_at) >= 0)
  ) {
    throw new LifecycleContractError("plan_invalidated");
  }
  return deepFreeze(parsed.data);
}

const approvalRank = new Map([
  ["standard", 0],
  ["elevated", 1],
  ["destructive", 2],
]);
const authenticationStrengthRank = new Map([
  ["bounded_session", 0],
  ["workload_attested", 1],
  ["phishing_resistant", 2],
]);

export function validateApprovalReceipt(
  value: unknown,
  plan: MutationPlanV1,
  now: string,
): ApprovalReceiptV1 {
  if (!plan.approval.required) throw new LifecycleContractError("approval_denied");
  const parsed = approvalReceiptSchema.safeParse(value);
  if (!parsed.success) throw new LifecycleContractError("approval_denied");
  const receipt = parsed.data;
  try {
    assertDigest(receipt, "approval_digest");
  } catch (error: unknown) {
    if (error instanceof LifecycleContractError) {
      throw new LifecycleContractError("approval_denied");
    }
    throw error;
  }
  if (
    receipt.plan_id !== plan.plan_id ||
    receipt.plan_digest !== plan.plan_digest ||
    canonicalAuditJson(receipt.bindings) !== canonicalAuditJson(approvalBindingsForPlan(plan)) ||
    receipt.required_level !== plan.approval.level ||
    receipt.decision !== "approve" ||
    receipt.satisfied_level === null ||
    (approvalRank.get(receipt.satisfied_level) ?? -1) <
      (approvalRank.get(receipt.required_level) ?? Number.POSITIVE_INFINITY) ||
    (authenticationStrengthRank.get(receipt.actor.authentication_strength) ?? -1) <
      (approvalRank.get(receipt.satisfied_level) ?? Number.POSITIVE_INFINITY) ||
    compareTimestamp(receipt.issued_at, receipt.expires_at) >= 0 ||
    compareTimestamp(receipt.issued_at, plan.created_at) < 0 ||
    compareTimestamp(receipt.expires_at, plan.expires_at) > 0 ||
    compareTimestamp(now, receipt.issued_at) < 0 ||
    compareTimestamp(now, receipt.expires_at) >= 0 ||
    receipt.actor.ref === plan.subject.ref
  ) {
    throw new LifecycleContractError("approval_denied");
  }
  return deepFreeze(receipt);
}

function deriveAggregate(steps: readonly Readonly<{ state: StepState }>[]): AggregateOutcome {
  const states = steps.map(({ state }) => state);
  if (
    states.includes("completion_unknown") ||
    states.includes("started") ||
    states.includes("failed")
  ) {
    return "completion_unknown";
  }
  const effects = states.filter((state) => state === "effect_observed").length;
  if (effects === states.length) return "effect_observed";
  if (states.every((state) => state === "no_effect_proven")) return "no_effect_proven";
  if (
    effects > 0 &&
    states.every(
      (state) =>
        state === "effect_observed" || state === "no_effect_proven" || state === "not_started",
    )
  ) {
    return "partial_effect";
  }
  return "completion_unknown";
}

export function aggregateStepOutcome(steps: readonly ExecutionStepRecord[]): AggregateOutcome {
  return deriveAggregate(steps);
}

export function validateExecutionRecord(value: unknown, plan?: MutationPlanV1): ExecutionRecordV1 {
  const parsed = executionRecordSchema.safeParse(value);
  if (!parsed.success) throw new LifecycleContractError("lifecycle_record_invalid");
  const record = parsed.data;
  assertDigest(record, "execution_digest");
  if (
    !exactUnique(record.steps.map(({ step_id }) => step_id)) ||
    record.aggregate_outcome !== deriveAggregate(record.steps) ||
    compareTimestamp(record.started_at, record.completed_at) > 0 ||
    (record.approval_id === null) !== (record.approval_digest === null) ||
    (plan !== undefined &&
      (record.plan_id !== plan.plan_id ||
        record.plan_digest !== plan.plan_digest ||
        record.attempt > plan.idempotency.max_attempts ||
        record.steps.length !== plan.operations.length ||
        record.steps.some(({ step_id }, index) => step_id !== plan.operations[index]?.step_id)))
  ) {
    throw new LifecycleContractError("lifecycle_record_invalid");
  }
  return deepFreeze(record);
}

function verificationOutcome(
  observations: readonly z.infer<typeof verificationObservationSchema>[],
): "verified" | "failed" | "inconclusive" {
  if (observations.some(({ status }) => status === "inconclusive")) return "inconclusive";
  if (observations.some(({ status }) => status === "failed")) return "failed";
  return "verified";
}

export function validateVerificationRecord(
  value: unknown,
  execution?: ExecutionRecordV1,
  plan?: MutationPlanV1,
): VerificationRecordV1 {
  const parsed = verificationRecordSchema.safeParse(value);
  if (!parsed.success) throw new LifecycleContractError("lifecycle_record_invalid");
  const record = parsed.data;
  assertDigest(record, "verification_digest");
  if (
    !exactUnique(record.observations.map(({ condition_ref }) => condition_ref)) ||
    record.outcome !== verificationOutcome(record.observations) ||
    compareTimestamp(record.started_at, record.completed_at) > 0 ||
    (execution !== undefined &&
      (record.execution_ref !== execution.execution_ref ||
        record.execution_digest !== execution.execution_digest ||
        compareTimestamp(record.started_at, execution.completed_at) < 0)) ||
    (plan !== undefined &&
      (record.plan_id !== plan.plan_id ||
        record.plan_digest !== plan.plan_digest ||
        record.verifier_ref !== plan.verification.verifier_ref ||
        record.profile !== plan.verification.profile ||
        record.observations.length !== plan.postconditions.length ||
        record.observations.some((observation, index) => {
          const condition = plan.postconditions[index];
          return (
            condition === undefined ||
            observation.condition_ref !== condition.condition_ref ||
            compareTimestamp(observation.observed_at, record.started_at) < 0 ||
            compareTimestamp(observation.observed_at, record.completed_at) > 0 ||
            compareTimestamp(observation.observed_at, condition.fresh_until) >= 0 ||
            (observation.status === "verified" &&
              observation.observation_digest !== condition.expected_digest)
          );
        })))
  ) {
    throw new LifecycleContractError("lifecycle_record_invalid");
  }
  return deepFreeze(record);
}

export function validateRollbackRecord(value: unknown, plan?: MutationPlanV1): RollbackRecordV1 {
  const parsed = rollbackRecordSchema.safeParse(value);
  if (!parsed.success) throw new LifecycleContractError("lifecycle_record_invalid");
  const record = parsed.data;
  assertDigest(record, "rollback_digest");
  if (
    (record.rollback_execution_ref === null) !== (record.rollback_execution_digest === null) ||
    (record.status === "requested" &&
      (record.rollback_execution_ref !== null || record.completed_at !== null)) ||
    (record.status !== "requested" && record.completed_at === null) ||
    (plan !== undefined &&
      (plan.rollback_context === null ||
        record.rollback_plan_id !== plan.plan_id ||
        record.rollback_plan_digest !== plan.plan_digest ||
        record.original_execution_ref !== plan.rollback_context.original_execution_ref ||
        record.original_execution_digest !== plan.rollback_context.original_execution_digest ||
        record.original_plan_digest !== plan.rollback_context.original_plan_digest ||
        record.observed_state_digest !== plan.rollback_context.observed_state_digest))
  ) {
    throw new LifecycleContractError("lifecycle_record_invalid");
  }
  return deepFreeze(record);
}

export function validateLifecycleRecord(
  kind: LifecycleRecordKind,
  value: unknown,
):
  MutationPlanV1 | ApprovalReceiptV1 | ExecutionRecordV1 | VerificationRecordV1 | RollbackRecordV1 {
  switch (kind) {
    case "plan":
      return validateMutationPlan(value);
    case "approval": {
      const parsed = approvalReceiptSchema.safeParse(value);
      if (!parsed.success) throw new LifecycleContractError("lifecycle_record_invalid");
      assertDigest(parsed.data, "approval_digest");
      return deepFreeze(parsed.data);
    }
    case "execution":
      return validateExecutionRecord(value);
    case "verification":
      return validateVerificationRecord(value);
    case "rollback":
      return validateRollbackRecord(value);
  }
}
