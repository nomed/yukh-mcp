import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, chmod, mkdir, mkdtemp, rm, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { LifecycleEngine } from "../../packages/lifecycle/src/engine.js";
import {
  openRepositoryLocalLifecycleLedgerForQualification,
  REPOSITORY_LOCAL_LIFECYCLE_PATH,
} from "../../packages/lifecycle/src/repository-local-ledger.js";
import type { LifecycleBoundary } from "../../packages/lifecycle/src/ports.js";
import {
  NOW,
  FakeAudit,
  FakeAuthorization,
  FakeConditions,
  FakeEffects,
  FakeVerifier,
  FixedClock,
  approvalFixture,
  planFixture,
} from "./lifecycle-test-fixtures.js";
import { parseCrashProtocolEvents } from "./fixtures/crash-protocol.js";

const scratchRoot = path.join(process.cwd(), ".audit-test-scratch");
const childPath = fileURLToPath(new URL("./fixtures/lifecycle-crash-child.ts", import.meta.url));
const lockRelativePath = path.join(REPOSITORY_LOCAL_LIFECYCLE_PATH, "writer.lock");
const BOUNDARIES: readonly LifecycleBoundary[] = [
  "pre_reservation",
  "post_reservation",
  "post_started_state",
  "pre_effect",
  "post_start",
  "pre_result",
  "post_result",
  "pre_verification",
  "post_verification",
  "pre_final",
  "post_final_audit",
];

async function repositoryRoot(prefix: string): Promise<string> {
  await mkdir(scratchRoot, { recursive: true, mode: 0o700 });
  await chmod(scratchRoot, 0o700);
  const root = await mkdtemp(path.join(scratchRoot, prefix));
  await chmod(root, 0o700);
  return root;
}

async function exists(file: string): Promise<boolean> {
  return access(file).then(
    () => true,
    () => false,
  );
}

test("real child crashes converge conservatively at every lifecycle boundary", async (t) => {
  for (const boundary of BOUNDARIES) {
    await t.test(boundary, async () => {
      const root = await repositoryRoot(`lifecycle-crash-${boundary}-`);
      try {
        const child = spawnSync(process.execPath, ["--import", "tsx", childPath, root, boundary], {
          cwd: process.cwd(),
          encoding: "utf8",
          env: process.env,
        });
        assert.equal(
          child.status,
          86,
          `child did not crash at ${boundary}: stdout=${child.stdout} stderr=${child.stderr}`,
        );
        assert.equal(child.signal, null);
        assert.deepEqual(parseCrashProtocolEvents(child.stdout), [
          { phase: "ready", fixture: "lifecycle" },
          {
            phase: "crash",
            fixture: "lifecycle",
            boundary,
            occurrence: 1,
          },
        ]);
        const effectExpected = [
          "post_start",
          "pre_result",
          "post_result",
          "pre_verification",
          "post_verification",
          "pre_final",
          "post_final_audit",
        ].includes(boundary);
        const verificationExpected = [
          "post_verification",
          "pre_final",
          "post_final_audit",
        ].includes(boundary);
        assert.equal(await exists(path.join(root, "effect.called")), effectExpected);
        assert.equal(await exists(path.join(root, "verify.called")), verificationExpected);

        await unlink(path.join(root, lockRelativePath));
        const ledger = await openRepositoryLocalLifecycleLedgerForQualification({
          trustedRepositoryRoot: root,
          writerRef: "impl_lifecycle_ledger001",
          now: () => new Date(NOW),
        });
        const effects = new FakeEffects();
        const engine = new LifecycleEngine({
          clock: new FixedClock(),
          authorization: new FakeAuthorization(),
          conditions: new FakeConditions(),
          effects,
          verifier: new FakeVerifier(),
          audit: new FakeAudit(),
          ledger,
        });
        const plan = planFixture();
        const retry = await engine.execute({
          plan,
          approval: approvalFixture(plan),
        });
        assert.equal(effects.calls, boundary === "pre_reservation" ? 1 : 0);
        assert.equal(
          retry.status,
          boundary === "pre_reservation"
            ? "succeeded"
            : boundary === "post_reservation"
              ? "denied"
              : "completion_unknown",
        );
        if (retry.status === "denied") {
          assert.equal(retry.code, "apply_already_reserved");
        }
        await ledger.close();

        const repeated = await openRepositoryLocalLifecycleLedgerForQualification({
          trustedRepositoryRoot: root,
          writerRef: "impl_lifecycle_ledger001",
          now: () => new Date(NOW),
        });
        assert.equal(repeated.diagnostic().reservations, 1);
        await repeated.close();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});
