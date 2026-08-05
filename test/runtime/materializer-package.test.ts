import assert from "node:assert/strict";
import test from "node:test";
import {
  createMaterializerPackageParser,
  MaterializerPackageError,
  MAX_MATERIALIZER_PACKAGE_BYTES,
  type MaterializerPackageExpectation,
} from "../../packages/materializer-package/src/materializer-package.js";

const expectation: MaterializerPackageExpectation = {
  binding: {
    profile: "synthetic/project-5-issue-27-legacy-apply-v1",
    scope: {
      owner: "synthetic-owner",
      repository: "synthetic-repository",
      projectNumber: 5,
      issueNumber: 27,
      policyPath: ".synthetic/project.yaml",
      mode: "legacy-apply-v1",
    },
    repositoryId: "1001",
    workflowRef:
      "synthetic-owner/synthetic-repository/.github/workflows/yukh-projects-apply.yml@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    eventName: "workflow_dispatch",
    environment: "synthetic-protected-apply",
    runId: "2002",
    runAttempt: 1,
    policyCommit: "b".repeat(40),
    producerRef: `synthetic-owner/synthetic-producer@${"c".repeat(40)}`,
    planId: "synthetic-plan-1",
    planDigest: `sha256:${"d".repeat(64)}`,
    operationSetDigest: `sha256:${"e".repeat(64)}`,
  },
  allowedMutationKinds: [
    "add_sub_issue",
    "create_project_field",
    "update_project_item_field_value",
  ],
  requestCeilings: { graphql: 3, rest: 1 },
};

function fixture() {
  return {
    package_version: 1,
    receipt: {
      id: "synthetic-one-time-receipt-0001",
      one_time: true,
    },
    binding: {
      profile: expectation.binding.profile,
      scope: {
        owner: expectation.binding.scope.owner,
        repository: expectation.binding.scope.repository,
        project_number: expectation.binding.scope.projectNumber,
        issue_number: expectation.binding.scope.issueNumber,
        policy_path: expectation.binding.scope.policyPath,
        mode: expectation.binding.scope.mode,
      },
      repository_id: expectation.binding.repositoryId,
      workflow_ref: expectation.binding.workflowRef,
      event_name: expectation.binding.eventName,
      environment: expectation.binding.environment,
      run_id: expectation.binding.runId,
      run_attempt: expectation.binding.runAttempt,
      policy_commit: expectation.binding.policyCommit,
      producer_ref: expectation.binding.producerRef,
      plan_id: expectation.binding.planId,
      plan_digest: expectation.binding.planDigest,
      operation_set_digest: expectation.binding.operationSetDigest,
    },
    issued_at: "2026-08-05T22:00:00.000Z",
    expires_at: "2026-08-05T22:14:00.000Z",
    credentials: {
      read: "synthetic-read-credential-0001",
      write: "synthetic-write-credential-0002",
    },
    approval: {
      envelope: "synthetic-approval-envelope-0003",
      trust_root: "synthetic-approval-trust-root-0004",
    },
    host_capsule: {
      enabled: true,
      scope: {
        owner: expectation.binding.scope.owner,
        repository: expectation.binding.scope.repository,
        project_number: expectation.binding.scope.projectNumber,
        issue_number: expectation.binding.scope.issueNumber,
        policy_path: expectation.binding.scope.policyPath,
        mode: expectation.binding.scope.mode,
      },
      rate_limits: {
        graphql: { reserve: 1_000, max_requests: 3 },
        rest: { reserve: 1_000, max_requests: 1 },
      },
      mutation_kinds: [...expectation.allowedMutationKinds],
      coordination_epoch: 7,
      credential: "synthetic-capsule-credential-0005",
      dpop_private_key: "synthetic-dpop-private-key-0006",
    },
  };
}

function canonical(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number")
    return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const source = value as Record<string, unknown>;
  return `{${Object.keys(source)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(source[key])}`)
    .join(",")}}`;
}

function serialized(change?: (value: ReturnType<typeof fixture>) => void): string {
  const value = fixture();
  change?.(value);
  return canonical(value);
}

function parser() {
  return createMaterializerPackageParser(expectation, () => new Date("2026-08-05T22:01:00.000Z"));
}

function assertInvalid(callback: () => unknown) {
  assert.throws(
    callback,
    (error: unknown) =>
      error instanceof MaterializerPackageError &&
      error.code === "materializer_package_invalid" &&
      !error.message.includes("synthetic"),
  );
}

test("parses one closed synthetic package without retaining material", () => {
  const materialized = parser().parse(serialized());

  assert.equal(materialized.binding.profile, expectation.binding.profile);
  assert.equal(materialized.hostCapsule.coordinationEpoch, 7);
  assert.deepEqual(materialized.hostCapsule.rateLimits, {
    graphql: { reserve: 1_000, maxRequests: 3 },
    rest: { reserve: 1_000, maxRequests: 1 },
  });
  assert.equal(String(materialized), "MaterializerPackage{REDACTED}");
  assert.equal(String(materialized.material.readCredential), "MaterializerSecret{REDACTED}");
  assert.equal(String(materialized).includes("synthetic-read-credential-0001"), false);
  assert.throws(() => JSON.stringify(materialized));
  assert.throws(() => JSON.stringify(materialized.material.hostCapsuleDpopPrivateKey));
});

test("accepts one parser attempt only", () => {
  const oneAttempt = parser();
  oneAttempt.parse(serialized());
  assertInvalid(() => oneAttempt.parse(serialized()));
});

test("rejects malformed, broadened, replayable, and over-budget synthetic packages", () => {
  const cases: readonly [string, string][] = [
    ["noncanonical JSON", ` ${serialized()}`],
    [
      "unknown field",
      serialized((value) => Object.assign(value, { unexpected: "synthetic-unknown-field" })),
    ],
    [
      "binding substitution",
      serialized((value) => {
        value.binding.plan_digest = `sha256:${"f".repeat(64)}`;
      }),
    ],
    [
      "producer pin substitution",
      serialized((value) => {
        value.binding.producer_ref = `synthetic-owner/synthetic-producer@${"f".repeat(40)}`;
      }),
    ],
    [
      "scope expansion",
      serialized((value) => {
        value.binding.scope.issue_number = 28;
      }),
    ],
    [
      "shared credentials",
      serialized((value) => {
        value.credentials.write = value.credentials.read;
      }),
    ],
    [
      "reusable receipt",
      serialized((value) => {
        value.receipt.one_time = false;
      }),
    ],
    [
      "long-lived package",
      serialized((value) => {
        value.expires_at = "2026-08-05T22:16:00.000Z";
      }),
    ],
    [
      "unapproved mutation kind",
      serialized((value) => {
        value.host_capsule.mutation_kinds = [
          ...value.host_capsule.mutation_kinds,
          "synthetic_unapproved_mutation",
        ];
      }),
    ],
    [
      "low GraphQL reserve",
      serialized((value) => {
        value.host_capsule.rate_limits.graphql.reserve = 999;
      }),
    ],
    [
      "excess GraphQL request ceiling",
      serialized((value) => {
        value.host_capsule.rate_limits.graphql.max_requests = 4;
      }),
    ],
    [
      "unsupported retry attempt",
      serialized((value) => {
        (value.binding as { run_attempt: number }).run_attempt = 2;
      }),
    ],
    ["oversized package", "x".repeat(MAX_MATERIALIZER_PACKAGE_BYTES + 1)],
  ];

  for (const [, source] of cases) {
    assertInvalid(() => parser().parse(source));
  }
});
