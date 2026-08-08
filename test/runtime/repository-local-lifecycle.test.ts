import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readdir, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { lifecycleDigest, type MutationPlanV1 } from "../../packages/lifecycle/src/contract.js";
import { LifecycleEngine } from "../../packages/lifecycle/src/engine.js";
import {
  openRepositoryLocalLifecycleLedgerForQualification,
  REPOSITORY_LOCAL_LIFECYCLE_PATH,
} from "../../packages/lifecycle/src/repository-local-ledger.js";
import {
  LifecyclePortError,
  type AttemptReservationBinding,
  type AttemptReservationLedger,
  type LifecycleBoundary,
} from "../../packages/lifecycle/src/ports.js";
import {
  NOW,
  FakeAudit,
  FakeAuthorization,
  FakeConditions,
  FakeEffects,
  FakeVerifier,
  FixedClock,
  approvalFixture,
  digest,
  planFixture,
  sealPlan,
} from "./lifecycle-test-fixtures.js";

const scratchRoot = path.join(process.cwd(), ".audit-test-scratch");
const lockRelativePath = path.join(REPOSITORY_LOCAL_LIFECYCLE_PATH, "writer.lock");

async function repositoryRoot(prefix: string): Promise<string> {
  await mkdir(scratchRoot, { recursive: true, mode: 0o700 });
  await chmod(scratchRoot, 0o700);
  const root = await mkdtemp(path.join(scratchRoot, prefix));
  await chmod(root, 0o700);
  return root;
}

function options(
  root: string,
  overrides: Readonly<{
    maxReservations?: number;
    maxBytes?: number;
    onFilesystemEvent?: (
      event:
        | "record.before_temp_create"
        | "record.after_temp_sync"
        | "record.after_publish"
        | "record.after_directory_sync",
    ) => void;
  }> = {},
) {
  return {
    trustedRepositoryRoot: root,
    writerRef: "impl_lifecycle_ledger001",
    now: () => new Date(NOW),
    ...overrides,
  };
}

function bindingFixture(
  overrides: Readonly<Partial<AttemptReservationBinding>> = {},
): AttemptReservationBinding {
  const base = {
    reservation_binding_version: 1 as const,
    reservation_ref: "reservation_example001",
    idempotency_scope_digest: digest("idempotency-scope"),
    plan_id: "plan_example001",
    plan_digest: digest("plan"),
    approval_id: "approval_example001",
    approval_digest: digest("approval"),
    approval_nonce_digest: digest("approval-nonce"),
    authorization_request_id: "authreq_apply001",
    authorization_request_digest: digest("authorization-request"),
    authorization_decision_id: "decision_apply001",
    authorization_decision_digest: digest("authorization-decision"),
    subject_ref: "subject_example001",
    capability_definition_digest: digest("capability-definition"),
    resource_set_digest: digest("resource-set"),
    environment_ref: "development",
    operation_set_digest: digest("operation-set"),
    attempt: 1,
    reserved_at: NOW,
    ...overrides,
  };
  const digestInput = Object.fromEntries(
    Object.entries(base).filter(([key]) => key !== "reservation_digest"),
  );
  return Object.freeze({
    ...base,
    reservation_digest: lifecycleDigest(digestInput),
  });
}

function engine(
  ledger: AttemptReservationLedger,
  effects = new FakeEffects(),
  boundary?: (boundary: LifecycleBoundary) => void,
) {
  return {
    effects,
    value: new LifecycleEngine({
      clock: new FixedClock(),
      authorization: new FakeAuthorization(),
      conditions: new FakeConditions(),
      effects,
      verifier: new FakeVerifier(),
      audit: new FakeAudit(),
      ledger,
      ...(boundary === undefined ? {} : { hooks: { onBoundary: boundary } }),
    }),
  };
}

test("repository-local reservation is durable, restart-stable, and immutable", async () => {
  const root = await repositoryRoot("lifecycle-ledger-restart-");
  try {
    const binding = bindingFixture();
    const ledger = await openRepositoryLocalLifecycleLedgerForQualification(options(root));
    const reserved = await ledger.reserve(binding);
    assert.equal(reserved.status, "reserved");
    await ledger.markStarted(binding.reservation_ref, binding.reservation_digest, NOW);
    assert.equal(
      (await ledger.read(binding.reservation_ref, binding.reservation_digest))?.state,
      "started",
    );
    await ledger.close();

    const reopened = await openRepositoryLocalLifecycleLedgerForQualification(options(root));
    const snapshot = await reopened.read(binding.reservation_ref, binding.reservation_digest);
    assert.equal(snapshot?.state, "started");
    assert.deepEqual(snapshot?.binding, binding);
    const duplicate = await reopened.reserve({
      ...bindingFixture({
        authorization_request_id: "authreq_apply002",
        authorization_request_digest: digest("authorization-request-2"),
        authorization_decision_id: "decision_apply002",
        authorization_decision_digest: digest("authorization-decision-2"),
      }),
    });

    assert.equal(duplicate.status, "duplicate");
    assert.equal(duplicate.snapshot.binding.reservation_digest, binding.reservation_digest);
    await reopened.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("restart completes a published reservation left with its linked temporary", async () => {
  const root = await repositoryRoot("lifecycle-ledger-linked-temp-");
  try {
    const initialized = await openRepositoryLocalLifecycleLedgerForQualification(options(root));
    await initialized.close();

    let interrupted = false;
    const interruptedLedger = await openRepositoryLocalLifecycleLedgerForQualification(
      options(root, {
        onFilesystemEvent: (event) => {
          if (!interrupted && event === "record.after_publish") {
            interrupted = true;
            throw new Error("simulated process interruption");
          }
        },
      }),
    );
    const binding = bindingFixture();
    await assert.rejects(interruptedLedger.reserve(binding), LifecyclePortError);
    await interruptedLedger.close();

    const recovered = await openRepositoryLocalLifecycleLedgerForQualification(options(root));
    const duplicate = await recovered.reserve(binding);
    assert.equal(duplicate.status, "duplicate");
    assert.equal(duplicate.snapshot.state, "not_started");
    await recovered.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("concurrent exact admission has one durable winner and conflicts stay denied", async () => {
  const root = await repositoryRoot("lifecycle-ledger-race-");
  try {
    const ledger = await openRepositoryLocalLifecycleLedgerForQualification(options(root));
    const binding = bindingFixture();
    const results = await Promise.all([ledger.reserve(binding), ledger.reserve(binding)]);
    assert.deepEqual(results.map(({ status }) => status).sort(), ["duplicate", "reserved"]);

    const conflict = bindingFixture({
      plan_id: "plan_other001",
      plan_digest: digest("other-plan"),
    });
    await assert.rejects(
      ledger.reserve(conflict),
      (error: unknown) =>
        error instanceof LifecyclePortError && error.code === "reservation_conflict",
    );
    assert.equal(ledger.diagnostic().state, "healthy");
    await ledger.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("approval nonce reuse across another reservation is a durable conflict", async () => {
  const root = await repositoryRoot("lifecycle-ledger-nonce-");
  try {
    const ledger = await openRepositoryLocalLifecycleLedgerForQualification(options(root));
    const first = bindingFixture();
    await ledger.reserve(first);
    const second = bindingFixture({
      reservation_ref: "reservation_other001",
      idempotency_scope_digest: digest("other-scope"),
      plan_id: "plan_other001",
      plan_digest: digest("other-plan"),
    });

    await assert.rejects(
      ledger.reserve(second),
      (error: unknown) =>
        error instanceof LifecyclePortError && error.code === "reservation_conflict",
    );
    await ledger.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ledger rejects an execution substituted across its reservation binding", async () => {
  const root = await repositoryRoot("lifecycle-ledger-execution-binding-");
  try {
    const binding = bindingFixture();
    const ledger = await openRepositoryLocalLifecycleLedgerForQualification(options(root));
    await ledger.reserve(binding);
    await ledger.markStarted(binding.reservation_ref, binding.reservation_digest, NOW);
    const base = {
      execution_record_version: 1 as const,
      execution_ref: "execution_example001",
      plan_id: binding.plan_id,
      plan_digest: binding.plan_digest,
      authorization_request_id: "authreq_substituted001",
      authorization_request_digest: digest("substituted-authorization-request"),
      authorization_decision_id: binding.authorization_decision_id,
      authorization_decision_digest: binding.authorization_decision_digest,
      approval_id: binding.approval_id,
      approval_digest: binding.approval_digest,
      reservation_ref: binding.reservation_ref,
      reservation_digest: binding.reservation_digest,
      attempt: binding.attempt,
      started_at: NOW,
      completed_at: NOW,
      steps: [
        {
          step_id: "step_update",
          state: "effect_observed" as const,
          reason_code: "effect_observed" as const,
          evidence_refs: ["evidence_effect001"],
        },
      ],
      aggregate_outcome: "effect_observed" as const,
    };
    await assert.rejects(
      ledger.recordExecution(binding.reservation_ref, binding.reservation_digest, {
        ...base,
        execution_digest: lifecycleDigest(base),
      }),
      (error: unknown) => error instanceof LifecyclePortError && error.code === "state_conflict",
    );
    assert.equal(
      (await ledger.read(binding.reservation_ref, binding.reservation_digest))?.state,
      "started",
    );
    await ledger.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("capacity and live-writer contention fail closed", async () => {
  const root = await repositoryRoot("lifecycle-ledger-capacity-");
  try {
    const ledger = await openRepositoryLocalLifecycleLedgerForQualification(
      options(root, { maxReservations: 1 }),
    );
    await ledger.reserve(bindingFixture());
    await assert.rejects(
      ledger.reserve(
        bindingFixture({
          reservation_ref: "reservation_second001",
          idempotency_scope_digest: digest("second-scope"),
          approval_id: "approval_second001",
          approval_digest: digest("second-approval"),
          approval_nonce_digest: digest("second-nonce"),
        }),
      ),
      (error: unknown) =>
        error instanceof LifecyclePortError && error.code === "reservation_capacity",
    );
    assert.equal(ledger.diagnostic().state, "failed");
    await assert.rejects(
      openRepositoryLocalLifecycleLedgerForQualification(options(root, { maxReservations: 1 })),
      (error: unknown) =>
        error instanceof LifecyclePortError && error.code === "reservation_unavailable",
    );
    await ledger.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("closed topology and file metadata reject substitution", async (t) => {
  await t.test("unknown root entry", async () => {
    const root = await repositoryRoot("lifecycle-ledger-unknown-");
    try {
      const ledger = await openRepositoryLocalLifecycleLedgerForQualification(options(root));
      await ledger.close();
      await writeFile(
        path.join(root, REPOSITORY_LOCAL_LIFECYCLE_PATH, "unexpected"),
        "not-authoritative",
        { mode: 0o600 },
      );
      await assert.rejects(
        openRepositoryLocalLifecycleLedgerForQualification(options(root)),
        LifecyclePortError,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test("wrong record mode", async () => {
    const root = await repositoryRoot("lifecycle-ledger-mode-");
    try {
      const ledger = await openRepositoryLocalLifecycleLedgerForQualification(options(root));
      await ledger.reserve(bindingFixture());
      await ledger.close();
      const reservations = path.join(root, REPOSITORY_LOCAL_LIFECYCLE_PATH, "reservations");
      const directory = (await readdir(reservations))[0];
      assert(directory);
      await chmod(path.join(reservations, directory, "reservation.json"), 0o644);
      await assert.rejects(
        openRepositoryLocalLifecycleLedgerForQualification(options(root)),
        LifecyclePortError,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

test("engine reaches the effect port only after reservation directory sync", async () => {
  const root = await repositoryRoot("lifecycle-ledger-order-");
  try {
    const sequence: string[] = [];
    const ledger = await openRepositoryLocalLifecycleLedgerForQualification(
      options(root, {
        onFilesystemEvent: (event) => {
          sequence.push(event);
        },
      }),
    );
    const effects = new FakeEffects();
    const originalApply = effects.apply.bind(effects);
    effects.apply = async (input) => {
      sequence.push("effect.apply");
      return originalApply(input);
    };
    const runtime = engine(ledger, effects);
    const plan = planFixture();
    const result = await runtime.value.execute({
      plan,
      approval: approvalFixture(plan),
    });

    assert.equal(result.status, "succeeded");
    const effect = sequence.indexOf("effect.apply");
    const lastDirectorySync = sequence.lastIndexOf("record.after_directory_sync", effect);
    assert(effect > 0);
    assert(lastDirectorySync >= 0);
    assert(lastDirectorySync < effect);
    await ledger.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the final reservation slot remains executable while new admission is denied", async () => {
  const root = await repositoryRoot("lifecycle-ledger-final-slot-");
  try {
    const ledger = await openRepositoryLocalLifecycleLedgerForQualification(
      options(root, { maxReservations: 1 }),
    );
    const runtime = engine(ledger);
    const plan = planFixture();
    const result = await runtime.value.execute({ plan, approval: approvalFixture(plan) });
    assert.equal(result.status, "succeeded");
    assert.equal(runtime.effects.calls, 1);

    const secondSource = structuredClone(plan) as unknown as Record<string, unknown>;
    secondSource.plan_id = "plan_second001";
    secondSource.idempotency = {
      classification: "keyed",
      key_digest: digest("second-key"),
      max_attempts: 1,
      retry: "never",
    };
    const second = sealPlan(secondSource);
    const denied = await runtime.value.execute({
      plan: second,
      approval: approvalFixture(second, {
        approval_id: "approval_second001",
        nonce_digest: digest("second-nonce"),
      }),
    });
    assert.equal(denied.status, "denied");
    assert.equal(runtime.effects.calls, 1);
    await ledger.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("completed exact apply returns stored result after real restart without another effect", async () => {
  const root = await repositoryRoot("lifecycle-ledger-engine-restart-");
  try {
    const plan = planFixture();
    const approval = approvalFixture(plan);
    const firstLedger = await openRepositoryLocalLifecycleLedgerForQualification(options(root));
    const first = engine(firstLedger);
    const firstResult = await first.value.execute({ plan, approval });
    assert.equal(firstResult.status, "succeeded");
    assert.equal(first.effects.calls, 1);
    await firstLedger.close();

    const secondLedger = await openRepositoryLocalLifecycleLedgerForQualification(options(root));
    const second = engine(secondLedger);
    const duplicate = await second.value.execute({ plan, approval });
    assert.equal(duplicate.status, "succeeded");
    assert.equal(duplicate.duplicate, true);
    assert.equal(second.effects.calls, 0);
    await secondLedger.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("post-start evidence failure remains durably unknown after restart", async () => {
  const root = await repositoryRoot("lifecycle-ledger-engine-unknown-");
  try {
    const plan = planFixture();
    const approval = approvalFixture(plan);
    const firstLedger = await openRepositoryLocalLifecycleLedgerForQualification(options(root));
    const audit = new FakeAudit();
    audit.failStage = "result.released";
    const firstEffects = new FakeEffects();
    const first = new LifecycleEngine({
      clock: new FixedClock(),
      authorization: new FakeAuthorization(),
      conditions: new FakeConditions(),
      effects: firstEffects,
      verifier: new FakeVerifier(),
      audit,
      ledger: firstLedger,
    });
    const firstResult = await first.execute({ plan, approval });
    assert.equal(firstResult.status, "completion_unknown");
    assert.equal(firstEffects.calls, 1);
    await firstLedger.close();

    const secondLedger = await openRepositoryLocalLifecycleLedgerForQualification(options(root));
    const second = engine(secondLedger);
    const duplicate = await second.value.execute({ plan, approval });
    assert.equal(duplicate.status, "completion_unknown");
    assert.equal(duplicate.duplicate, true);
    assert.equal(second.effects.calls, 0);
    await secondLedger.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("capacity denial through the real ledger proves zero effect calls", async () => {
  const root = await repositoryRoot("lifecycle-ledger-engine-capacity-");
  try {
    const ledger = await openRepositoryLocalLifecycleLedgerForQualification(
      options(root, { maxReservations: 1 }),
    );
    await ledger.reserve(bindingFixture());
    const runtime = engine(ledger);
    const source = structuredClone(planFixture()) as unknown as Record<string, unknown>;
    source.plan_id = "plan_capacity001";
    source.idempotency = {
      classification: "keyed",
      key_digest: digest("capacity-key"),
      max_attempts: 1,
      retry: "never",
    };
    const plan: MutationPlanV1 = sealPlan(source);
    const result = await runtime.value.execute({
      plan,
      approval: approvalFixture(plan, {
        approval_id: "approval_capacity001",
        nonce_digest: digest("capacity-nonce"),
      }),
    });
    assert.equal(result.status, "denied");
    assert.equal(runtime.effects.calls, 0);
    await ledger.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a stale crash lock is never removed automatically", async () => {
  const root = await repositoryRoot("lifecycle-ledger-lock-");
  try {
    const ledger = await openRepositoryLocalLifecycleLedgerForQualification(options(root));
    await assert.rejects(
      openRepositoryLocalLifecycleLedgerForQualification(options(root)),
      LifecyclePortError,
    );
    await ledger.close();
    await assert.rejects(unlink(path.join(root, lockRelativePath)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
