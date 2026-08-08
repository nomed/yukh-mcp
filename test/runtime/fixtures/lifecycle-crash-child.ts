import { writeFile } from "node:fs/promises";
import path from "node:path";
import { LifecycleEngine } from "../../../packages/lifecycle/src/engine.js";
import { openRepositoryLocalLifecycleLedgerForQualification } from "../../../packages/lifecycle/src/repository-local-ledger.js";
import type { LifecycleBoundary } from "../../../packages/lifecycle/src/ports.js";
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
} from "../lifecycle-test-fixtures.js";

const [, , repositoryRoot, boundaryValue] = process.argv;
const boundaries: readonly LifecycleBoundary[] = [
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
if (repositoryRoot === undefined || !boundaries.some((boundary) => boundary === boundaryValue)) {
  process.exit(64);
}
const boundary = boundaryValue as LifecycleBoundary;
const ledger = await openRepositoryLocalLifecycleLedgerForQualification({
  trustedRepositoryRoot: repositoryRoot,
  writerRef: "impl_lifecycle_ledger001",
  now: () => new Date(NOW),
});
const effects = new FakeEffects();
const effectApply = effects.apply.bind(effects);
effects.apply = async (input) => {
  await writeFile(path.join(repositoryRoot, "effect.called"), "called", {
    mode: 0o600,
    flag: "wx",
  });
  return effectApply(input);
};
const verifier = new FakeVerifier();
const verify = verifier.verify.bind(verifier);
verifier.verify = async (input) => {
  await writeFile(path.join(repositoryRoot, "verify.called"), "called", {
    mode: 0o600,
    flag: "wx",
  });
  return verify(input);
};
const engine = new LifecycleEngine({
  clock: new FixedClock(),
  authorization: new FakeAuthorization(),
  conditions: new FakeConditions(),
  effects,
  verifier,
  audit: new FakeAudit(),
  ledger,
  hooks: {
    onBoundary: (observed) => {
      if (observed === boundary) process.exit(86);
    },
  },
});
const plan = planFixture();
await engine.execute({ plan, approval: approvalFixture(plan) });
await ledger.close();
process.exit(65);
