import { isValidAuditTimestamp } from "../../../audit/src/contract.js";
import {
  lifecycleDigest,
  validateExecutionRecord,
  validateMutationPlan,
  LifecycleContractError,
  type ExecutionRecordV1,
  type MutationPlanV1,
} from "../../../lifecycle/src/contract.js";
import {
  LifecyclePortError,
  type ConditionObservation,
  type EffectPortResult,
  type LifecycleConditionPort,
  type LifecycleEffectPort,
  type LifecycleVerificationPort,
  type VerificationPortResult,
} from "../../../lifecycle/src/ports.js";

export const EXAMPLE_SETTING_IMPLEMENTATION_REF = "impl_example_setting_qualification_v1";
export const EXAMPLE_SETTING_CAPABILITY_ID = "example.setting.update";
export const EXAMPLE_SETTING_CAPABILITY_VERSION = "1.0.0";
export const EXAMPLE_SETTING_DEFINITION_DIGEST =
  "sha256:d3436429587715737dc9fbae282eeff4d9296600e98f30c735d49c0c4356b0a7";
export const EXAMPLE_SETTING_RESOURCE_KIND = "example_setting";
export const EXAMPLE_SETTING_RESOURCE_REF = "setting-example-01";
export const EXAMPLE_SETTING_ENVIRONMENT = "development";
export const EXAMPLE_SETTING_NAME = "display_mode";
export const EXAMPLE_SETTING_VALUE = "compact";
export const EXAMPLE_SETTING_VERIFIER_REF = "setting_value_matches";
export const EXAMPLE_SETTING_STATE_CONDITION_REF = "setting_state_matches";
export const EXAMPLE_SETTING_CAPACITY_CONDITION_REF = "provider_capacity_available";
export const EXAMPLE_SETTING_OPERATION_SET_DIGEST =
  "sha256:dbff0e308503e936c076944c420d89c38c6882d49238583aabbd6929d0f897ad";
export const EXAMPLE_SETTING_RESTORE_CAPABILITY_ID = "example.setting.restore";
export const EXAMPLE_SETTING_RESTORE_CAPABILITY_VERSION = "1.0.0";
export const EXAMPLE_SETTING_RESTORE_STEP_ID = "step_restore_setting";
export const EXAMPLE_SETTING_UPDATE_STEP_ID = "step_update_setting";
export const EXAMPLE_SETTING_QUALIFICATION_TIME = "2026-08-08T07:05:39.000Z";

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

export const EXAMPLE_SETTING_DEFINITION = freezeDeep({
  contract_version: 1,
  capability: {
    id: EXAMPLE_SETTING_CAPABILITY_ID,
    version: EXAMPLE_SETTING_CAPABILITY_VERSION,
    summary: "Update one bounded synthetic setting",
    stability: "experimental",
  },
  resource: { kinds: [EXAMPLE_SETTING_RESOURCE_KIND], cardinality: "one" },
  environment: { required: true },
  operation: { model: "typed", class: "mutate", effects: ["update"] },
  input: {
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["name", "value"],
      properties: {
        name: {
          type: "string",
          pattern: "^[a-z][a-z0-9_]{0,31}$",
          maxLength: 32,
        },
        value: { type: "string", minLength: 1, maxLength: 128 },
      },
    },
  },
  output: {
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["changed", "version"],
      properties: {
        changed: { type: "boolean" },
        version: {
          type: "integer",
          minimum: 1,
          maximum: 2_147_483_647,
        },
      },
    },
  },
  risk: { level: "high", data_classes: ["synthetic_configuration"] },
  mutation: { mode: "planned", destructive: false },
  approval: { mode: "explicit" },
  execution: {
    timeout_ms: 10_000,
    max_attempts: 1,
    concurrency: "per_resource",
    max_input_bytes: 4_096,
    max_output_bytes: 8_192,
  },
  idempotency: { classification: "keyed", key: "required" },
  retry: { policy: "never" },
  verification: { mode: "required", postconditions: [EXAMPLE_SETTING_VERIFIER_REF] },
  rollback: { mode: "restore" },
  errors: { taxonomy_version: 1 },
} as const);

export const EXAMPLE_SETTING_OPERATION_SET = freezeDeep([
  { kind: "update", field: EXAMPLE_SETTING_NAME },
] as const);

export const EXAMPLE_SETTING_UPDATE_INPUT = freezeDeep({
  name: EXAMPLE_SETTING_NAME,
  value: EXAMPLE_SETTING_VALUE,
} as const);

export const EXAMPLE_SETTING_RESTORE_AUTHORIZATION_DEFINITION = freezeDeep({
  capability: {
    id: EXAMPLE_SETTING_RESTORE_CAPABILITY_ID,
    version: EXAMPLE_SETTING_RESTORE_CAPABILITY_VERSION,
  },
  operation: { class: "mutate", effects: ["update"] },
  approval: { mode: "explicit" },
} as const);

export const EXAMPLE_SETTING_RESTORE_DEFINITION_DIGEST = lifecycleDigest(
  EXAMPLE_SETTING_RESTORE_AUTHORIZATION_DEFINITION,
);
export const EXAMPLE_SETTING_CAPACITY_AVAILABLE_DIGEST = lifecycleDigest({
  available: true,
  implementation_ref: EXAMPLE_SETTING_IMPLEMENTATION_REF,
});
export const EXAMPLE_SETTING_CAPACITY_UNAVAILABLE_DIGEST = lifecycleDigest({
  available: false,
  implementation_ref: EXAMPLE_SETTING_IMPLEMENTATION_REF,
});

if (lifecycleDigest(EXAMPLE_SETTING_DEFINITION) !== EXAMPLE_SETTING_DEFINITION_DIGEST) {
  throw new TypeError("example setting definition digest mismatch");
}
if (lifecycleDigest(EXAMPLE_SETTING_OPERATION_SET) !== EXAMPLE_SETTING_OPERATION_SET_DIGEST) {
  throw new TypeError("example setting operation-set digest mismatch");
}

export interface ExampleSettingStateFact {
  readonly state_fact_version: 1;
  readonly resource_kind: typeof EXAMPLE_SETTING_RESOURCE_KIND;
  readonly resource_ref: typeof EXAMPLE_SETTING_RESOURCE_REF;
  readonly environment_ref: typeof EXAMPLE_SETTING_ENVIRONMENT;
  readonly name: typeof EXAMPLE_SETTING_NAME;
  readonly value: string;
  readonly version: number;
}

export interface ExampleSettingSnapshot extends ExampleSettingStateFact {
  readonly state_digest: string;
  readonly observed_at: string;
}

export interface ExampleSettingRestoreInput {
  readonly name: typeof EXAMPLE_SETTING_NAME;
  readonly value: string;
  readonly source_snapshot_digest: string;
  readonly original_execution_ref: string;
  readonly original_execution_digest: string;
  readonly original_plan_digest: string;
}

export interface ExampleSettingQualificationDiagnostic {
  readonly health: "ready" | "failed";
  readonly remaining_capacity: number;
  readonly effect_port_calls: number;
  readonly mutations: number;
  readonly condition_calls: number;
  readonly verifier_calls: number;
  readonly external_calls: 0;
}

export interface ExampleSettingQualificationOptions {
  readonly now?: () => string;
  readonly healthy?: boolean;
  readonly maxMutations?: number;
  readonly initialValue?: string;
  readonly initialVersion?: number;
}

interface RestoreSource {
  readonly original_plan_digest: string;
  readonly prior: ExampleSettingStateFact;
  readonly resulting: ExampleSettingStateFact;
}

interface StoredEffect {
  readonly binding_digest: string;
  readonly result: EffectPortResult;
}

type PlanKind = "update" | "restore";
type PortPhase = "precondition" | "effect" | "verification";

function stateFact(value: string, version: number): ExampleSettingStateFact {
  return freezeDeep({
    state_fact_version: 1,
    resource_kind: EXAMPLE_SETTING_RESOURCE_KIND,
    resource_ref: EXAMPLE_SETTING_RESOURCE_REF,
    environment_ref: EXAMPLE_SETTING_ENVIRONMENT,
    name: EXAMPLE_SETTING_NAME,
    value,
    version,
  });
}

export function exampleSettingStateDigest(fact: ExampleSettingStateFact): string {
  return lifecycleDigest(fact);
}

function phaseError(phase: PortPhase): LifecyclePortError {
  switch (phase) {
    case "precondition":
      return new LifecyclePortError("precondition_unavailable");
    case "effect":
      return new LifecyclePortError("effect_unavailable");
    case "verification":
      return new LifecyclePortError("verification_unavailable");
  }
}

function exactValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function expectedVerificationRef(executionDigest: string): string {
  return `verification_${executionDigest.slice("sha256:".length, "sha256:".length + 40)}`;
}

export class ExampleSettingQualificationProvider
  implements LifecycleConditionPort, LifecycleEffectPort, LifecycleVerificationPort
{
  private readonly clock: () => string;
  private readonly maxMutations: number;
  private readonly healthy: boolean;
  private current: ExampleSettingStateFact;
  private readonly effectsByKey = new Map<string, StoredEffect>();
  private readonly restoreSources = new Map<string, RestoreSource>();
  private effectPortCalls = 0;
  private mutations = 0;
  private conditionCalls = 0;
  private verifierCalls = 0;

  constructor(options: ExampleSettingQualificationOptions = {}) {
    const initialValue = options.initialValue ?? "expanded";
    const initialVersion = options.initialVersion ?? 7;
    const maxMutations = options.maxMutations ?? 2;
    if (
      initialValue.length < 1 ||
      initialValue.length > 128 ||
      !Number.isSafeInteger(initialVersion) ||
      initialVersion < 1 ||
      initialVersion >= 2_147_483_647 ||
      !Number.isSafeInteger(maxMutations) ||
      maxMutations < 0 ||
      maxMutations > 64
    ) {
      throw new TypeError("invalid example setting qualification options");
    }
    this.clock = options.now ?? (() => EXAMPLE_SETTING_QUALIFICATION_TIME);
    if (!isValidAuditTimestamp(this.clock())) {
      throw new TypeError("invalid example setting qualification clock");
    }
    this.maxMutations = maxMutations;
    this.healthy = options.healthy ?? true;
    this.current = stateFact(initialValue, initialVersion);
  }

  snapshot(): ExampleSettingSnapshot {
    return freezeDeep({
      ...this.current,
      state_digest: exampleSettingStateDigest(this.current),
      observed_at: this.now("verification"),
    });
  }

  expectedUpdateSnapshot(): ExampleSettingSnapshot {
    const expected = stateFact(EXAMPLE_SETTING_VALUE, this.current.version + 1);
    return freezeDeep({
      ...expected,
      state_digest: exampleSettingStateDigest(expected),
      observed_at: this.now("verification"),
    });
  }

  expectedRestoreSnapshot(originalExecutionRef: string): ExampleSettingSnapshot {
    const source = this.restoreSources.get(originalExecutionRef);
    if (source === undefined) throw new LifecyclePortError("state_conflict");
    const expected = stateFact(source.prior.value, this.current.version + 1);
    return freezeDeep({
      ...expected,
      state_digest: exampleSettingStateDigest(expected),
      observed_at: this.now("verification"),
    });
  }

  restoreInput(
    input: Readonly<{
      original_execution_ref: string;
      original_execution_digest: string;
      original_plan_digest: string;
    }>,
  ): ExampleSettingRestoreInput {
    const source = this.restoreSources.get(input.original_execution_ref);
    if (source === undefined || source.original_plan_digest !== input.original_plan_digest) {
      throw new LifecyclePortError("state_conflict");
    }
    return freezeDeep({
      name: EXAMPLE_SETTING_NAME,
      value: source.prior.value,
      source_snapshot_digest: exampleSettingStateDigest(source.prior),
      original_execution_ref: input.original_execution_ref,
      original_execution_digest: input.original_execution_digest,
      original_plan_digest: input.original_plan_digest,
    });
  }

  diagnostic(): ExampleSettingQualificationDiagnostic {
    return freezeDeep({
      health: this.healthy ? "ready" : "failed",
      remaining_capacity: Math.max(0, this.maxMutations - this.mutations),
      effect_port_calls: this.effectPortCalls,
      mutations: this.mutations,
      condition_calls: this.conditionCalls,
      verifier_calls: this.verifierCalls,
      external_calls: 0,
    });
  }

  async observe(
    input: Readonly<{
      plan: MutationPlanV1;
      condition: MutationPlanV1["preconditions"][number];
    }>,
  ): Promise<ConditionObservation> {
    this.conditionCalls += 1;
    const plan = this.validatePlan(input.plan, "precondition");
    if (!this.healthy) throw phaseError("precondition");
    const condition = plan.preconditions.find(
      ({ condition_ref }) => condition_ref === input.condition.condition_ref,
    );
    if (condition === undefined || condition.observation_ref !== input.condition.observation_ref) {
      throw phaseError("precondition");
    }
    let observationDigest: string;
    switch (condition.condition_ref) {
      case EXAMPLE_SETTING_STATE_CONDITION_REF:
        observationDigest = exampleSettingStateDigest(this.current);
        break;
      case EXAMPLE_SETTING_CAPACITY_CONDITION_REF:
        observationDigest =
          this.mutations < this.maxMutations
            ? EXAMPLE_SETTING_CAPACITY_AVAILABLE_DIGEST
            : EXAMPLE_SETTING_CAPACITY_UNAVAILABLE_DIGEST;
        break;
      default:
        throw phaseError("precondition");
    }
    return freezeDeep({
      condition_ref: condition.condition_ref,
      observation_ref: condition.observation_ref,
      observation_digest: observationDigest,
      observed_at: this.now("precondition"),
    });
  }

  async apply(
    input: Readonly<{
      execution_ref: string;
      plan: MutationPlanV1;
      attempt: number;
      signal: AbortSignal;
    }>,
  ): Promise<EffectPortResult> {
    this.effectPortCalls += 1;
    if (input.signal.aborted || input.attempt !== 1) throw phaseError("effect");
    const plan = this.validatePlan(input.plan, "effect");
    const key = plan.idempotency.key_digest;
    if (key === null) throw phaseError("effect");
    const bindingDigest = this.effectBindingDigest(input.execution_ref, plan);
    const stored = this.effectsByKey.get(key);
    if (stored !== undefined) {
      if (stored.binding_digest !== bindingDigest) {
        throw new LifecyclePortError("state_conflict");
      }
      return stored.result;
    }
    if (!this.healthy || this.mutations >= this.maxMutations) throw phaseError("effect");

    const kind = this.planKind(plan, "effect");
    this.assertNewIntent(plan, kind);
    const prior = this.current;
    const next =
      kind === "update"
        ? stateFact(EXAMPLE_SETTING_VALUE, prior.version + 1)
        : stateFact(this.restoreSource(plan).prior.value, prior.version + 1);
    this.current = next;
    this.mutations += 1;
    if (kind === "update") {
      this.restoreSources.set(
        input.execution_ref,
        freezeDeep({
          original_plan_digest: plan.plan_digest,
          prior,
          resulting: next,
        }),
      );
    }

    const evidenceRef = `evidence_setting_${lifecycleDigest({
      binding_digest: bindingDigest,
      resulting_state_digest: exampleSettingStateDigest(next),
    }).slice("sha256:".length, "sha256:".length + 40)}`;
    const result = freezeDeep({
      steps: [
        {
          step_id: plan.operations[0]?.step_id ?? EXAMPLE_SETTING_UPDATE_STEP_ID,
          state: "effect_observed" as const,
          reason_code: "effect_observed" as const,
          evidence_refs: [evidenceRef],
        },
      ],
    });
    this.effectsByKey.set(key, freezeDeep({ binding_digest: bindingDigest, result }));
    return result;
  }

  async verify(
    input: Readonly<{
      verification_ref: string;
      plan: MutationPlanV1;
      execution: ExecutionRecordV1;
      signal: AbortSignal;
    }>,
  ): Promise<VerificationPortResult> {
    this.verifierCalls += 1;
    if (input.signal.aborted || !this.healthy) throw phaseError("verification");
    const plan = this.validatePlan(input.plan, "verification");
    let execution: ExecutionRecordV1;
    try {
      execution = validateExecutionRecord(input.execution, plan);
    } catch (error: unknown) {
      if (error instanceof LifecycleContractError) throw phaseError("verification");
      throw error;
    }
    if (
      execution.aggregate_outcome !== "effect_observed" ||
      input.verification_ref !== expectedVerificationRef(execution.execution_digest)
    ) {
      throw phaseError("verification");
    }
    const condition = plan.postconditions[0];
    if (condition === undefined || condition.condition_ref !== EXAMPLE_SETTING_VERIFIER_REF) {
      throw phaseError("verification");
    }
    const observedAt = this.now("verification");
    if (Date.parse(observedAt) >= Date.parse(condition.fresh_until)) {
      throw phaseError("verification");
    }
    const actualDigest = exampleSettingStateDigest(this.current);
    const status = actualDigest === condition.expected_digest ? "verified" : "failed";
    const evidenceRef = `evidence_verifier_${lifecycleDigest({
      execution_digest: execution.execution_digest,
      actual_state_digest: actualDigest,
      expected_state_digest: condition.expected_digest,
      status,
    }).slice("sha256:".length, "sha256:".length + 40)}`;
    return freezeDeep({
      observations: [
        {
          condition_ref: condition.condition_ref,
          status,
          observation_digest: actualDigest,
          evidence_ref: evidenceRef,
          observed_at: observedAt,
        },
      ],
    });
  }

  private now(phase: PortPhase): string {
    const value = this.clock();
    if (!isValidAuditTimestamp(value)) throw phaseError(phase);
    return value;
  }

  private validatePlan(plan: MutationPlanV1, phase: PortPhase): MutationPlanV1 {
    let validated: MutationPlanV1;
    try {
      validated = validateMutationPlan(plan, this.now(phase));
    } catch (error: unknown) {
      if (error instanceof LifecycleContractError) throw phaseError(phase);
      throw error;
    }
    this.planKind(validated, phase);
    return validated;
  }

  private planKind(plan: MutationPlanV1, phase: PortPhase): PlanKind {
    const common =
      plan.scope.resource_kind === EXAMPLE_SETTING_RESOURCE_KIND &&
      exactValues(plan.scope.resource_refs, [EXAMPLE_SETTING_RESOURCE_REF]) &&
      plan.scope.environment_ref === EXAMPLE_SETTING_ENVIRONMENT &&
      plan.capability.operation_class === "mutate" &&
      exactValues(plan.capability.effects, ["update"]) &&
      plan.capability.approval_mode === "explicit" &&
      plan.idempotency.classification === "keyed" &&
      plan.idempotency.key_digest !== null &&
      plan.idempotency.max_attempts === 1 &&
      plan.idempotency.retry === "never" &&
      plan.verification.profile === "independent" &&
      plan.verification.verifier_ref === EXAMPLE_SETTING_VERIFIER_REF &&
      exactValues(plan.verification.postcondition_refs, [EXAMPLE_SETTING_VERIFIER_REF]) &&
      plan.postconditions.length === 1 &&
      plan.postconditions[0]?.condition_ref === EXAMPLE_SETTING_VERIFIER_REF &&
      plan.operations.length === 1 &&
      plan.operations[0]?.effect === "update" &&
      exactValues(plan.operations[0]?.precondition_refs ?? [], [
        EXAMPLE_SETTING_STATE_CONDITION_REF,
        EXAMPLE_SETTING_CAPACITY_CONDITION_REF,
      ]) &&
      exactValues(plan.operations[0]?.postcondition_refs ?? [], [EXAMPLE_SETTING_VERIFIER_REF]) &&
      plan.preconditions.length === 2 &&
      plan.preconditions[0]?.condition_ref === EXAMPLE_SETTING_STATE_CONDITION_REF &&
      plan.preconditions[1]?.condition_ref === EXAMPLE_SETTING_CAPACITY_CONDITION_REF &&
      plan.preconditions[1]?.expected_digest === EXAMPLE_SETTING_CAPACITY_AVAILABLE_DIGEST;
    if (!common) throw phaseError(phase);

    if (
      plan.capability.id === EXAMPLE_SETTING_CAPABILITY_ID &&
      plan.capability.version === EXAMPLE_SETTING_CAPABILITY_VERSION &&
      plan.capability.definition_digest === EXAMPLE_SETTING_DEFINITION_DIGEST
    ) {
      if (
        plan.request.normalized_input_digest !== lifecycleDigest(EXAMPLE_SETTING_UPDATE_INPUT) ||
        plan.operations[0]?.step_id !== EXAMPLE_SETTING_UPDATE_STEP_ID ||
        plan.rollback.mode !== "restore" ||
        plan.rollback.capability?.id !== EXAMPLE_SETTING_RESTORE_CAPABILITY_ID ||
        plan.rollback.capability.version !== EXAMPLE_SETTING_RESTORE_CAPABILITY_VERSION ||
        plan.rollback.capability.definition_digest !== EXAMPLE_SETTING_RESTORE_DEFINITION_DIGEST ||
        plan.rollback_context !== null
      ) {
        throw phaseError(phase);
      }
      return "update";
    }

    if (
      plan.capability.id === EXAMPLE_SETTING_RESTORE_CAPABILITY_ID &&
      plan.capability.version === EXAMPLE_SETTING_RESTORE_CAPABILITY_VERSION &&
      plan.capability.definition_digest === EXAMPLE_SETTING_RESTORE_DEFINITION_DIGEST
    ) {
      const context = plan.rollback_context;
      if (
        context === null ||
        plan.operations[0]?.step_id !== EXAMPLE_SETTING_RESTORE_STEP_ID ||
        plan.rollback.mode !== "unavailable" ||
        plan.rollback.capability !== null
      ) {
        throw phaseError(phase);
      }
      let expectedInput: ExampleSettingRestoreInput;
      try {
        expectedInput = this.restoreInput({
          original_execution_ref: context.original_execution_ref,
          original_execution_digest: context.original_execution_digest,
          original_plan_digest: context.original_plan_digest,
        });
      } catch (error: unknown) {
        if (error instanceof LifecyclePortError) throw phaseError(phase);
        throw error;
      }
      if (plan.request.normalized_input_digest !== lifecycleDigest(expectedInput)) {
        throw phaseError(phase);
      }
      return "restore";
    }
    throw phaseError(phase);
  }

  private effectBindingDigest(executionRef: string, plan: MutationPlanV1): string {
    return lifecycleDigest({
      execution_ref: executionRef,
      plan_id: plan.plan_id,
      plan_digest: plan.plan_digest,
      subject_ref: plan.subject.ref,
      capability: plan.capability,
      resource_set_digest: plan.scope.resource_set_digest,
      environment_ref: plan.scope.environment_ref,
      normalized_input_digest: plan.request.normalized_input_digest,
      idempotency_key_digest: plan.idempotency.key_digest,
      lifecycle_operation_set_digest: plan.operation_set_digest,
      fixture_operation_set_digest:
        this.planKind(plan, "effect") === "update"
          ? EXAMPLE_SETTING_OPERATION_SET_DIGEST
          : lifecycleDigest([{ kind: "restore", field: EXAMPLE_SETTING_NAME }]),
    });
  }

  private assertNewIntent(plan: MutationPlanV1, kind: PlanKind): void {
    const currentDigest = exampleSettingStateDigest(this.current);
    const stateCondition = plan.preconditions[0];
    const postcondition = plan.postconditions[0];
    if (
      stateCondition?.expected_digest !== currentDigest ||
      plan.target_snapshot.digest !== currentDigest ||
      postcondition === undefined
    ) {
      throw new LifecyclePortError("state_conflict");
    }
    const expected =
      kind === "update"
        ? stateFact(EXAMPLE_SETTING_VALUE, this.current.version + 1)
        : stateFact(this.restoreSource(plan).prior.value, this.current.version + 1);
    if (postcondition.expected_digest !== exampleSettingStateDigest(expected)) {
      throw new LifecyclePortError("state_conflict");
    }
    if (kind === "restore" && plan.rollback_context?.observed_state_digest !== currentDigest) {
      throw new LifecyclePortError("state_conflict");
    }
  }

  private restoreSource(plan: MutationPlanV1): RestoreSource {
    const reference = plan.rollback_context?.original_execution_ref;
    const source = reference === undefined ? undefined : this.restoreSources.get(reference);
    if (
      source === undefined ||
      source.original_plan_digest !== plan.rollback_context?.original_plan_digest ||
      exampleSettingStateDigest(source.resulting) !== plan.rollback_context.observed_state_digest
    ) {
      throw new LifecyclePortError("state_conflict");
    }
    return source;
  }
}
