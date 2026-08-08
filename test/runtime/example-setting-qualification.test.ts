import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { openRepositoryLocalAuditProfileForQualification } from "../../packages/audit/src/repository-local.js";
import { AuditWriter } from "../../packages/audit/src/writer.js";
import { lifecycleDigest } from "../../packages/lifecycle/src/contract.js";
import { LifecycleEngine } from "../../packages/lifecycle/src/engine.js";
import {
  LifecyclePortError,
  type LifecycleVerificationPort,
} from "../../packages/lifecycle/src/ports.js";
import { openRepositoryLocalLifecycleLedgerForQualification } from "../../packages/lifecycle/src/repository-local-ledger.js";
import {
  EXAMPLE_SETTING_CAPABILITY_ID,
  EXAMPLE_SETTING_CAPABILITY_VERSION,
  EXAMPLE_SETTING_DEFINITION,
  EXAMPLE_SETTING_DEFINITION_DIGEST,
  EXAMPLE_SETTING_ENVIRONMENT,
  EXAMPLE_SETTING_OPERATION_SET,
  EXAMPLE_SETTING_OPERATION_SET_DIGEST,
  EXAMPLE_SETTING_RESOURCE_KIND,
  EXAMPLE_SETTING_RESTORE_CAPABILITY_ID,
  EXAMPLE_SETTING_UPDATE_INPUT,
  EXAMPLE_SETTING_VERIFIER_REF,
  ExampleSettingQualificationProvider,
} from "../../packages/providers/synthetic-local/src/example-setting.js";
import {
  ExampleSettingAuthorization,
  QUALIFICATION_NOW,
  QualificationClock,
  RecordingLifecycleAudit,
  durableAuditPort,
  exampleSettingRestorePlan,
  exampleSettingUpdatePlan,
  memoryQualificationHarness,
  qualificationApproval,
  qualificationStreamCandidate,
} from "./example-setting-qualification-fixtures.js";
import { FakeAudit, MemoryLedger, digest, sealPlan } from "./lifecycle-test-fixtures.js";

const scratchRoot = path.join(process.cwd(), ".audit-test-scratch");
const evidencePath = path.join(
  process.cwd(),
  "docs/reference/example-setting-qualification-v1.json",
);
const implementationPath = path.join(
  process.cwd(),
  "packages/providers/synthetic-local/src/example-setting.ts",
);

async function repositoryRoot(prefix: string): Promise<string> {
  await mkdir(scratchRoot, { recursive: true, mode: 0o700 });
  await chmod(scratchRoot, 0o700);
  const root = await mkdtemp(path.join(scratchRoot, prefix));
  await chmod(root, 0o700);
  return root;
}

async function openDurableHarness(
  root: string,
  provider: ExampleSettingQualificationProvider,
  options: Readonly<{
    failStage?: "execution.completed";
    prefix?: string;
  }> = {},
) {
  const plan = exampleSettingUpdatePlan(provider);
  const approval = qualificationApproval(plan);
  const profile = await openRepositoryLocalAuditProfileForQualification({
    trustedRepositoryRoot: root,
    writerRef: "impl_example_setting_audit_v1",
    now: () => new Date(QUALIFICATION_NOW),
    filesystemHooks: { filesystemKindOverride: "ext" },
  });
  const writer = new AuditWriter({
    store: profile.store,
    streamRef: "stream_example_setting001",
    writerRef: "impl_example_setting_audit_v1",
    now: () => new Date(QUALIFICATION_NOW),
  });
  await writer.commit(qualificationStreamCandidate(plan));
  const delegate = await durableAuditPort(
    writer,
    profile,
    plan,
    approval,
    options.prefix ?? "setting_update",
  );
  const audit = new RecordingLifecycleAudit(delegate, options.failStage ?? null);
  const ledger = await openRepositoryLocalLifecycleLedgerForQualification({
    trustedRepositoryRoot: root,
    writerRef: "impl_example_setting_ledger_v1",
    now: () => new Date(QUALIFICATION_NOW),
  });
  const authorization = new ExampleSettingAuthorization(provider);
  const engine = new LifecycleEngine({
    clock: new QualificationClock(),
    authorization,
    conditions: provider,
    effects: provider,
    verifier: provider,
    audit,
    ledger,
  });
  return { plan, approval, profile, writer, audit, ledger, authorization, engine };
}

test("canonical capability and implementation evidence is exact and network-free", async () => {
  const definition = JSON.parse(
    await readFile(
      path.join(process.cwd(), "contracts/capability/v1/examples/mutation-definition.json"),
      "utf8",
    ),
  ) as unknown;
  assert.deepEqual(definition, EXAMPLE_SETTING_DEFINITION);
  assert.equal(lifecycleDigest(definition), EXAMPLE_SETTING_DEFINITION_DIGEST);
  assert.equal(
    lifecycleDigest(EXAMPLE_SETTING_OPERATION_SET),
    EXAMPLE_SETTING_OPERATION_SET_DIGEST,
  );
  assert.deepEqual(EXAMPLE_SETTING_OPERATION_SET, [{ kind: "update", field: "display_mode" }]);

  const implementation = await readFile(implementationPath);
  const implementationDigest = `sha256:${createHash("sha256")
    .update(implementation)
    .digest("hex")}`;
  const source = implementation.toString("utf8");
  assert.doesNotMatch(source, /(?:node:(?:http|https|net|tls|dns|child_process)|\bfetch\s*\()/u);

  const evidence = JSON.parse(await readFile(evidencePath, "utf8")) as {
    readonly implementation: {
      readonly source_path: string;
      readonly source_digest: string;
    };
    readonly evidence_digest: string;
    readonly [key: string]: unknown;
  };
  assert.equal(
    evidence.implementation.source_path,
    "packages/providers/synthetic-local/src/example-setting.ts",
  );
  assert.equal(evidence.implementation.source_digest, implementationDigest);
  const { evidence_digest: evidenceDigest, ...unsigned } = evidence;
  assert.equal(lifecycleDigest(unsigned), evidenceDigest);
});

test("effect port provides exact keyed replay, concurrent deduplication, and conflict rejection", async () => {
  const provider = new ExampleSettingQualificationProvider();
  const plan = exampleSettingUpdatePlan(provider);
  const input = Object.freeze({
    execution_ref: "execution_direct_setting001",
    plan,
    attempt: 1,
    signal: new AbortController().signal,
  });
  const [first, duplicate] = await Promise.all([provider.apply(input), provider.apply(input)]);
  assert.strictEqual(duplicate, first);
  assert.equal(provider.snapshot().value, "compact");
  assert.deepEqual(provider.diagnostic(), {
    health: "ready",
    remaining_capacity: 1,
    effect_port_calls: 2,
    mutations: 1,
    condition_calls: 0,
    verifier_calls: 0,
    external_calls: 0,
  });

  const conflict = exampleSettingUpdatePlan(provider, {
    planId: "plan_setting_update_conflict",
    requestId: "request_setting_update_conflict",
    planningSuffix: "setting_update_conflict",
  });
  await assert.rejects(
    provider.apply({
      execution_ref: "execution_direct_setting_conflict",
      plan: conflict,
      attempt: 1,
      signal: new AbortController().signal,
    }),
    (error: unknown) => error instanceof LifecyclePortError && error.code === "state_conflict",
  );
  assert.equal(provider.diagnostic().mutations, 1);
  assert.equal(provider.snapshot().version, 8);
});

test("lifecycle releases success only after the deterministic verifier", async () => {
  const provider = new ExampleSettingQualificationProvider();
  const audit = new FakeAudit();
  const harness = memoryQualificationHarness(provider, { audit });
  const plan = exampleSettingUpdatePlan(provider);
  const result = await harness.engine.execute({
    plan,
    approval: qualificationApproval(plan),
  });
  assert.equal(result.status, "succeeded");
  assert.equal(result.status === "succeeded" && result.verification.outcome, "verified");
  assert.equal(provider.diagnostic().verifier_calls, 1);
  assert(
    audit.records.findIndex(({ stage }) => stage === "verification.completed") <
      audit.records.findIndex(({ stage }) => stage === "result.released"),
  );

  const effectProvider = new ExampleSettingQualificationProvider();
  const staleVerifier = new ExampleSettingQualificationProvider({
    initialValue: "compact",
    initialVersion: 7,
  });
  const mismatchHarness = memoryQualificationHarness(effectProvider, {
    verifier: staleVerifier,
  });
  const mismatchPlan = exampleSettingUpdatePlan(effectProvider);
  const mismatch = await mismatchHarness.engine.execute({
    plan: mismatchPlan,
    approval: qualificationApproval(mismatchPlan, "setting_mismatch001"),
  });
  assert.equal(mismatch.status, "failed");
  assert.equal(mismatch.status === "failed" && mismatch.code, "verification_failed");
  assert.equal(effectProvider.diagnostic().mutations, 1);
  assert.equal(staleVerifier.diagnostic().verifier_calls, 1);
});

test("denial, expiry, substitution, health, and capacity fail before the effect port", async (t) => {
  await t.test("explicit policy denial", async () => {
    const provider = new ExampleSettingQualificationProvider();
    const authorization = new ExampleSettingAuthorization(provider);
    authorization.effect = "deny";
    const harness = memoryQualificationHarness(provider, { authorization });
    const plan = exampleSettingUpdatePlan(provider);
    const result = await harness.engine.execute({
      plan,
      approval: qualificationApproval(plan, "setting_denied001"),
    });
    assert.equal(result.status, "denied");
    assert.equal(result.status === "denied" && result.code, "authorization_denied");
    assert.equal(provider.diagnostic().effect_port_calls, 0);
    assert.equal(provider.diagnostic().external_calls, 0);
  });

  await t.test("expired plan", async () => {
    const provider = new ExampleSettingQualificationProvider();
    const harness = memoryQualificationHarness(provider, {
      clock: new QualificationClock("2026-08-08T08:00:00.000Z"),
    });
    const plan = exampleSettingUpdatePlan(provider);
    const result = await harness.engine.execute({
      plan,
      approval: qualificationApproval(plan, "setting_expired001"),
    });
    assert.equal(result.status, "denied");
    assert.equal(result.status === "denied" && result.code, "plan_invalidated");
    assert.equal(provider.diagnostic().effect_port_calls, 0);
    assert.equal(provider.diagnostic().external_calls, 0);
  });

  await t.test("target substitution", async () => {
    const provider = new ExampleSettingQualificationProvider();
    const harness = memoryQualificationHarness(provider);
    const plan = exampleSettingUpdatePlan(provider);
    const changed = structuredClone(plan) as Record<string, unknown>;
    const scope = {
      ...structuredClone(plan.scope),
      resource_refs: ["setting-example-02"],
      resource_set_digest: digest("substituted-resource-set"),
    };
    changed.scope = scope;
    changed.predicted_effects = [
      {
        effect: "update",
        resource_set_digest: scope.resource_set_digest,
        destructive: false,
        data_classes: ["synthetic_configuration"],
      },
    ];
    const substituted = sealPlan(changed);
    const result = await harness.engine.execute({
      plan: substituted,
      approval: qualificationApproval(plan, "setting_original001"),
    });
    assert.equal(result.status, "denied");
    assert.equal(result.status === "denied" && result.code, "approval_denied");
    assert.equal(provider.diagnostic().effect_port_calls, 0);
    assert.equal(provider.diagnostic().external_calls, 0);
  });

  await t.test("provider health", async () => {
    const provider = new ExampleSettingQualificationProvider({ healthy: false });
    const harness = memoryQualificationHarness(provider);
    const plan = exampleSettingUpdatePlan(provider);
    const result = await harness.engine.execute({
      plan,
      approval: qualificationApproval(plan, "setting_unhealthy001"),
    });
    assert.equal(result.status, "denied");
    assert.equal(result.status === "denied" && result.code, "precondition_failed");
    assert.equal(provider.diagnostic().effect_port_calls, 0);
    assert.equal(provider.diagnostic().external_calls, 0);
  });

  await t.test("provider capacity", async () => {
    const provider = new ExampleSettingQualificationProvider({ maxMutations: 0 });
    const harness = memoryQualificationHarness(provider);
    const plan = exampleSettingUpdatePlan(provider);
    const result = await harness.engine.execute({
      plan,
      approval: qualificationApproval(plan, "setting_capacity001"),
    });
    assert.equal(result.status, "denied");
    assert.equal(result.status === "denied" && result.code, "precondition_failed");
    assert.equal(provider.diagnostic().effect_port_calls, 0);
    assert.equal(provider.diagnostic().external_calls, 0);
  });

  await t.test("audit health", async () => {
    const provider = new ExampleSettingQualificationProvider();
    const audit = new FakeAudit();
    audit.ready = false;
    const harness = memoryQualificationHarness(provider, { audit });
    const plan = exampleSettingUpdatePlan(provider);
    const result = await harness.engine.execute({
      plan,
      approval: qualificationApproval(plan, "setting_audit_health001"),
    });
    assert.equal(result.status, "denied");
    assert.equal(result.status === "denied" && result.code, "audit_unavailable");
    assert.equal(provider.diagnostic().effect_port_calls, 0);
    assert.equal(provider.diagnostic().external_calls, 0);
  });

  await t.test("reservation health", async () => {
    const provider = new ExampleSettingQualificationProvider();
    const ledger = new MemoryLedger();
    ledger.ready = false;
    const harness = memoryQualificationHarness(provider, { ledger });
    const plan = exampleSettingUpdatePlan(provider);
    const result = await harness.engine.execute({
      plan,
      approval: qualificationApproval(plan, "setting_ledger_health001"),
    });
    assert.equal(result.status, "denied");
    assert.equal(result.status === "denied" && result.code, "reservation_unavailable");
    assert.equal(provider.diagnostic().effect_port_calls, 0);
    assert.equal(provider.diagnostic().external_calls, 0);
  });
});

test("lifecycle replay, conflicting reuse, and concurrent duplicate call the effect once", async () => {
  const provider = new ExampleSettingQualificationProvider();
  const harness = memoryQualificationHarness(provider);
  const plan = exampleSettingUpdatePlan(provider);
  const approval = qualificationApproval(plan);
  const [left, right] = await Promise.all([
    harness.engine.execute({ plan, approval }),
    harness.engine.execute({ plan, approval }),
  ]);
  assert(
    [left, right].some(({ status }) => status === "succeeded"),
    "one concurrent caller must complete the lifecycle",
  );
  assert.equal(provider.diagnostic().mutations, 1);
  assert.equal(provider.diagnostic().effect_port_calls, 1);
  const duplicate = [left, right].find(({ duplicate: isDuplicate }) => isDuplicate);
  assert(duplicate);
  assert(
    duplicate.status === "succeeded" ||
      (duplicate.status === "denied" && duplicate.code === "apply_already_reserved"),
  );

  const conflict = exampleSettingUpdatePlan(provider, {
    planId: "plan_setting_lifecycle_conflict",
    requestId: "request_setting_lifecycle_conflict",
    planningSuffix: "setting_lifecycle_conflict",
  });
  const conflictResult = await harness.engine.execute({
    plan: conflict,
    approval: qualificationApproval(conflict, "setting_lifecycle_conflict"),
  });
  assert.equal(conflictResult.status, "denied");
  assert.equal(conflictResult.status === "denied" && conflictResult.code, "reservation_conflict");
  assert.equal(provider.diagnostic().effect_port_calls, 1);
  assert.equal(provider.diagnostic().external_calls, 0);
});

test("accepted durable writer and repository-local ledger retain verification-gated success", async () => {
  const root = await repositoryRoot("example-setting-durable-success-");
  let harness: Awaited<ReturnType<typeof openDurableHarness>> | undefined;
  try {
    const provider = new ExampleSettingQualificationProvider();
    harness = await openDurableHarness(root, provider);
    const result = await harness.engine.execute({
      plan: harness.plan,
      approval: harness.approval,
    });
    assert.equal(result.status, "succeeded");
    assert.equal(result.status === "succeeded" && result.duplicate, false);
    assert.equal(provider.diagnostic().effect_port_calls, 1);
    assert.equal(provider.diagnostic().verifier_calls, 1);
    assert.equal(provider.diagnostic().external_calls, 0);
    assert.equal(harness.profile.diagnostic().state, "healthy");
    assert.equal(harness.ledger.diagnostic().state, "healthy");
    assert.equal(harness.audit.records.at(-1)?.stage, "result.released");
  } finally {
    await harness?.ledger.close();
    await harness?.profile.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("lost post-effect audit outcome is journaled and never retried after restart", async () => {
  const root = await repositoryRoot("example-setting-durable-unknown-");
  let harness: Awaited<ReturnType<typeof openDurableHarness>> | undefined;
  try {
    const provider = new ExampleSettingQualificationProvider();
    harness = await openDurableHarness(root, provider, {
      failStage: "execution.completed",
      prefix: "setting_unknown",
    });
    const result = await harness.engine.execute({
      plan: harness.plan,
      approval: harness.approval,
    });
    assert.equal(result.status, "completion_unknown");
    assert.equal(result.status === "completion_unknown" && result.recovery, "journaled");
    assert.equal(provider.snapshot().value, "compact");
    assert.equal(provider.diagnostic().mutations, 1);
    assert.equal(provider.diagnostic().verifier_calls, 0);

    const facts: unknown[] = [];
    for await (const fact of harness.profile.pendingFacts()) facts.push(fact);
    assert.equal(facts.length, 1);

    await harness.ledger.close();
    await harness.profile.close();
    const replayProvider = new ExampleSettingQualificationProvider();
    const reopened = await openRepositoryLocalLifecycleLedgerForQualification({
      trustedRepositoryRoot: root,
      writerRef: "impl_example_setting_ledger_v1",
      now: () => new Date(QUALIFICATION_NOW),
    });
    try {
      const replayHarness = memoryQualificationHarness(replayProvider, {
        ledger: reopened,
      });
      const replay = await replayHarness.engine.execute({
        plan: harness.plan,
        approval: harness.approval,
      });
      assert.equal(replay.status, "completion_unknown");
      assert.equal(replay.status === "completion_unknown" && replay.duplicate, true);
      assert.equal(replayProvider.diagnostic().effect_port_calls, 0);
      assert.equal(replayProvider.diagnostic().external_calls, 0);
    } finally {
      await reopened.close();
    }
    harness = undefined;
  } finally {
    await harness?.ledger.close();
    await harness?.profile.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("verifier detects stale state and execution or target substitution", async () => {
  const provider = new ExampleSettingQualificationProvider();
  const harness = memoryQualificationHarness(provider);
  const plan = exampleSettingUpdatePlan(provider);
  const result = await harness.engine.execute({
    plan,
    approval: qualificationApproval(plan, "setting_verifier_source001"),
  });
  assert.equal(result.status, "succeeded");
  if (result.status !== "succeeded") return;

  const stale = new ExampleSettingQualificationProvider({
    initialValue: "compact",
    initialVersion: 7,
  });
  const staleResult = await stale.verify({
    verification_ref: result.verification.verification_ref,
    plan,
    execution: result.execution,
    signal: new AbortController().signal,
  });
  assert.equal(staleResult.observations[0]?.status, "failed");
  assert.notEqual(
    staleResult.observations[0]?.observation_digest,
    plan.postconditions[0]?.expected_digest,
  );

  const changed = structuredClone(plan) as Record<string, unknown>;
  changed.plan_id = "plan_setting_verifier_substitution";
  const substituted = sealPlan(changed);
  await assert.rejects(
    stale.verify({
      verification_ref: result.verification.verification_ref,
      plan: substituted,
      execution: result.execution,
      signal: new AbortController().signal,
    }),
    (error: unknown) =>
      error instanceof LifecyclePortError && error.code === "verification_unavailable",
  );
});

test("restore rollback is separately authorized, ordered, verified, and can fail closed", async () => {
  const provider = new ExampleSettingQualificationProvider();
  const audit = new FakeAudit();
  const harness = memoryQualificationHarness(provider, { audit });
  const originalPlan = exampleSettingUpdatePlan(provider);
  const original = await harness.engine.execute({
    plan: originalPlan,
    approval: qualificationApproval(originalPlan, "setting_original001"),
  });
  assert.equal(original.status, "succeeded");
  if (original.status !== "succeeded") return;

  const restorePlan = exampleSettingRestorePlan(provider, originalPlan, original.execution);
  const rollbackBase = {
    rollback_record_version: 1 as const,
    rollback_ref: "rollback_setting_restore001",
    original_execution_ref: original.execution.execution_ref,
    original_execution_digest: original.execution.execution_digest,
    original_plan_digest: originalPlan.plan_digest,
    observed_state_digest: restorePlan.rollback_context?.observed_state_digest,
    rollback_plan_id: restorePlan.plan_id,
    rollback_plan_digest: restorePlan.plan_digest,
    rollback_execution_ref: null,
    rollback_execution_digest: null,
    status: "requested" as const,
    requested_at: QUALIFICATION_NOW,
    completed_at: null,
  };
  const rollback = {
    ...rollbackBase,
    rollback_digest: lifecycleDigest(rollbackBase),
  };
  const restored = await harness.engine.executeRollback({
    plan: restorePlan,
    approval: qualificationApproval(restorePlan, "setting_restore001"),
    rollback,
    original_plan: originalPlan,
    original_execution: original.execution,
  });
  assert.equal(restored.status, "completed");
  assert.equal(restored.apply.status, "succeeded");
  assert.equal(provider.snapshot().value, "expanded");
  assert.equal(provider.snapshot().version, 9);
  assert.equal(harness.authorization.calls, 2);
  assert.equal(provider.diagnostic().mutations, 2);
  const requestedIndex = audit.records.findIndex(({ stage }) => stage === "rollback.requested");
  const rollbackPlanIndex = audit.records.findIndex(
    ({ stage }, index) => index > requestedIndex && stage === "plan.created",
  );
  const completedIndex = audit.records.findIndex(({ stage }) => stage === "rollback.completed");
  assert(requestedIndex >= 0);
  assert(rollbackPlanIndex > requestedIndex);
  assert(completedIndex > rollbackPlanIndex);

  const capacityProvider = new ExampleSettingQualificationProvider({
    maxMutations: 1,
  });
  const failureAudit = new FakeAudit();
  const failureHarness = memoryQualificationHarness(capacityProvider, {
    audit: failureAudit,
  });
  const failureOriginalPlan = exampleSettingUpdatePlan(capacityProvider, {
    planId: "plan_setting_failure_source",
    requestId: "request_setting_failure_source",
    planningSuffix: "setting_failure_source",
  });
  const failureOriginal = await failureHarness.engine.execute({
    plan: failureOriginalPlan,
    approval: qualificationApproval(failureOriginalPlan, "setting_failure_source"),
  });
  assert.equal(failureOriginal.status, "succeeded");
  if (failureOriginal.status !== "succeeded") return;
  const failureRestorePlan = exampleSettingRestorePlan(
    capacityProvider,
    failureOriginalPlan,
    failureOriginal.execution,
  );
  const failureRollbackBase = {
    rollback_record_version: 1 as const,
    rollback_ref: "rollback_setting_failure001",
    original_execution_ref: failureOriginal.execution.execution_ref,
    original_execution_digest: failureOriginal.execution.execution_digest,
    original_plan_digest: failureOriginalPlan.plan_digest,
    observed_state_digest: failureRestorePlan.rollback_context?.observed_state_digest,
    rollback_plan_id: failureRestorePlan.plan_id,
    rollback_plan_digest: failureRestorePlan.plan_digest,
    rollback_execution_ref: null,
    rollback_execution_digest: null,
    status: "requested" as const,
    requested_at: QUALIFICATION_NOW,
    completed_at: null,
  };
  const failure = await failureHarness.engine.executeRollback({
    plan: failureRestorePlan,
    approval: qualificationApproval(failureRestorePlan, "setting_failure_restore"),
    rollback: {
      ...failureRollbackBase,
      rollback_digest: lifecycleDigest(failureRollbackBase),
    },
    original_plan: failureOriginalPlan,
    original_execution: failureOriginal.execution,
  });
  assert.equal(failure.status, "failed");
  assert.equal(failure.apply.status, "denied");
  assert.equal(failure.apply.status === "denied" && failure.apply.code, "precondition_failed");
  assert.equal(capacityProvider.diagnostic().effect_port_calls, 1);
  assert.equal(capacityProvider.snapshot().value, "compact");
  assert.equal(failureAudit.records.at(-1)?.stage, "rollback.failed");
});

test("fixture constants carry only the bounded synthetic contract", () => {
  assert.equal(EXAMPLE_SETTING_CAPABILITY_ID, "example.setting.update");
  assert.equal(EXAMPLE_SETTING_CAPABILITY_VERSION, "1.0.0");
  assert.equal(EXAMPLE_SETTING_RESOURCE_KIND, "example_setting");
  assert.equal(EXAMPLE_SETTING_ENVIRONMENT, "development");
  assert.equal(EXAMPLE_SETTING_VERIFIER_REF, "setting_value_matches");
  assert.equal(EXAMPLE_SETTING_RESTORE_CAPABILITY_ID, "example.setting.restore");
  assert.deepEqual(EXAMPLE_SETTING_UPDATE_INPUT, {
    name: "display_mode",
    value: "compact",
  });
  assert.equal(
    lifecycleDigest(EXAMPLE_SETTING_OPERATION_SET),
    "sha256:dbff0e308503e936c076944c420d89c38c6882d49238583aabbd6929d0f897ad",
  );
});
