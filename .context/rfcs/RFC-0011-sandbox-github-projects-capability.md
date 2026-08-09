# RFC-0011 - Sandbox Projects add-dependency Effect B capability

- Status: Proposed
- Authors: Copilot
- Created: 2026-08-09
- Revised: 2026-08-09
- Governing issue: https://github.com/nomed/yukh-mcp/issues/96
- Suite mission: accepted `nomed/nomed.github.io` RFC-0005 on `main` at
  `12d9215f10c4b7fb1762a5025367e3e81543800f`
- Autonomous-maintainer mandate: accepted `nomed/nomed.github.io` RFC-0007 at
  `bb8628edf7a07c2af56f07e4f9140f58c851ef47`
- Accepted Projects authority:
  `nomed/yukh-projects@521be0d0ef1297579e84a6322dea29f80c2549dc`
- Accepted Projects effects contract:
  `docs/contracts/first-usable-preview-projects-v1.md`
- Accepted compound-admission contract:
  `docs/contracts/mcp-compound-approval-wrapper-v1.md`
- Depends on: RFC-0001, RFC-0002, RFC-0003, RFC-0004, RFC-0005, RFC-0006,
  RFC-0010
- Producer baseline:
  `nomed/yukh-projects v1.7.0@71784218366805922e5a12903eef9073f715f59f`

This proposal is a contract-review record only. It authorizes no
implementation, registration, discovery, gateway wiring, workflow activation,
OIDC trust, materializer, credential, endpoint, provider call, GitHub request,
mutation, teardown, deployment, release, preview tag, or readiness claim.

The Projects contracts and compound-admission schema are Accepted, but their
acceptance is specification-only. RFC-0011 remains blocked until Projects
separately implements and immutably publishes the bridge verifier and
`runMcpEffectBControlledApplyV1` wrapper artifacts with source commits, artifact
digests, provenance, SBOM, and conformance evidence. RFC-0011 must then pin
those exact artifacts and receive its required acceptance before a separate
implementation issue may proceed.

RFC-0007 through RFC-0009 govern the unrelated Project 5 / issue 27 migration
profile. Its static-token exception is not reused here.

## Author conflict decision

Accepted Projects effects v1 fixes Effect B as capability
`projects.add-dependency.v1` with exactly one
`add_dependency(201 blocks 202)` operation. The earlier Proposed RFC-0011
instead named a status-setting capability. Those operations are not aliases and
cannot exact-match one plan or approval.

Under Accepted RFC-0007 at
`bb8628edf7a07c2af56f07e4f9140f58c851ef47`, the author resolves this
Proposed-versus-Accepted conflict by:

1. **least authority expansion** - use the already accepted dependency
   capability rather than introduce a second Effect B mutation;
2. **already-Accepted semantics** - preserve Projects effects v1 exactly;
3. **compatibility** - keep the Projects plan, approvals, bridge, wrapper,
   postcondition, teardown, and evidence contracts aligned;
4. **reversibility** - revise this Proposed record instead of reinterpreting an
   Accepted operation; and
5. **smallest diff in authority** - remove the unaccepted status and restore
   capabilities without adding substitute authority.

The immutable Class B author record for the exact review head is posted to
governing issue #96. This decision is author-only and review-ready. It does not
review, accept, merge, implement, or activate RFC-0011.

## Summary

Define one Yukh MCP Effect B mutation contract:
`projects.add-dependency.v1@1.0.0`. The capability may add exactly one
dependency in the invented suite-preview sandbox:

```text
add_dependency(201 blocks 202)
```

The repository is `example-org/example-repo`, the synthetic Project is `7`,
the primary issue is `201`, and the related issue is `202`. These are fixed
contract fixtures, not caller input and not authority to create or discover
similarly named live resources.

Effect B requires one MCP plan `B-MCP` and a distinct nested Projects plan
`B-Projects`. It also requires two independently authenticated approvals:

- MCP `ApprovalReceiptV1` for `B-MCP`; and
- the unchanged Projects `SignedApprovalEnvelope` v1 for `B-Projects`.

The Accepted authenticated `yukh-projects-approval-bridge-v2` cross-binds both
approvals, both plans, the fixed target, exact operation, producer and wrapper
releases, postcondition, principals, nonces, lease bindings, policy, and expiry.
The bridge is evidence, not authorization. Neither approval authorizes,
derives, translates, or substitutes for the other.

The only permitted Projects boundary is the Accepted
`runMcpEffectBControlledApplyV1` wrapper contract. The wrapper specification is
Accepted; no executable wrapper or bridge-verifier artifact is published by
the pinned authority commit. Direct composition of Projects primitives remains
forbidden.

Effect B is independent from suite Effect A. Effect A uses synthetic issue
`101` and exactly one `set_field_value(status, backlog -> ready)` operation.
Effect B uses synthetic issues `201` and `202` and exactly one
`add_dependency`. The effects share no authority-bearing plan, approval,
snapshot, nonce, lease, idempotency key, credential, verifier, receipt, or
audit chain.

## Goals

- freeze one exact Effect B capability, target, operation, and postcondition;
- preserve Accepted Projects semantics without reinterpretation;
- keep public input free of target, relationship, provider, credential,
  endpoint, query, command, workflow, policy, approval, or plan selectors;
- require distinct planning and apply authorization decisions under RFC-0002;
- require separately signed and verified MCP and Projects approvals;
- pin the Accepted bridge v2 and wrapper contract authority;
- require future immutable executable artifacts before implementation;
- preserve Projects nonce, fenced lease, precondition, one-attempt mutation,
  targeted verification, and zero-drift semantics;
- durably commit admission evidence before provider start;
- independently verify the exact dependency postcondition;
- preserve durable `completion_unknown` and prohibit automatic retry; and
- declare rollback unavailable because Accepted Projects contracts do not
  authorize dependency removal.

## Non-goals

- mark RFC-0011 Accepted;
- register, expose, implement, invoke, or test a provider;
- add a gateway tool, resource, prompt, demo path, or registry entry;
- implement the bridge verifier or wrapper;
- compose `verifySignedApproval`, `parseProtectedHostCapsule`,
  `createControlledApplyHostFactory`, or `runApplyEntrypoint` in MCP;
- enable OIDC, a workflow, `id-token: write`, a materializer, trust root,
  Coordination endpoint, credential, GitHub App, or network path;
- call GitHub, Projects, Coordination, or a materializer;
- create or discover the invented repository, Project, or issues;
- remove a dependency, restore state, or use effect authority for teardown;
- reuse Effect A or Project 5 authority;
- expose generic Projects, relationship, GraphQL, REST, workflow-dispatch,
  shell, command, or HTTP capabilities;
- publish an implementation artifact, release, deployment, or readiness claim;
  or
- change Accepted Projects planning, approval, controlled-apply, or teardown
  semantics.

## Fixed preview profile

The logical profile is
`yukh-mcp/suite-preview-effect-b-add-dependency-v1`. It binds exactly:

- logical environment `suite_preview_sandbox`;
- resource kind `github_issue_dependency`;
- logical resource `preview_effect_b_dependency_201_blocks_202`;
- invented repository `example-org/example-repo`;
- invented Project `7`;
- primary issue `201`;
- related issue `202`;
- relationship direction `201 blocks 202`;
- capability `projects.add-dependency.v1@1.0.0`;
- one Projects operation `add_dependency(201 blocks 202)`;
- MCP plan `B-MCP`;
- nested Projects plan `B-Projects`;
- MCP Approval `B-MCP`;
- Projects Approval `B-Projects`;
- the canonical Accepted `effectBPostconditionBinding`;
- bridge schema `yukh-projects-approval-bridge-v2`;
- bridge profile `suite-preview-effect-b-v1`;
- wrapper entrypoint contract `runMcpEffectBControlledApplyV1`;
- wrapper entrypoint version `mcp-effect-b-controlled-apply-v1`;
- Yukh Projects mode `apply`;
- internal reconciliation mode `native-v1`;
- producer baseline
  `71784218366805922e5a12903eef9073f715f59f`;
- producer apply artifact `yukh-projects-apply-library-1.7.0.js` with SHA-256
  `e37a6d50f0cc862b4f8c68ec5b9be2386184a69c6800fcbb98cc132e46ffa9a2`;
  and
- future immutable bridge-verifier, wrapper, MCP verifier, target-profile,
  policy, and deployment bindings selected only by later accepted records.

The invented fixture identifiers are immutable contract values. They are
neither capability input nor permission to access provider state.

The environment domains remain distinct:

- MCP policy uses `suite_preview_sandbox`;
- the Projects reconciliation operation retains its accepted planner
  environment semantics; and
- approvals, protected host, and controlled apply use one later fixed protected
  workflow environment.

No display-name equality grants authority.

## Capability definition

The exact RFC-0001 logical definition is:

```yaml
contract_version: 1
capability:
  id: projects.add-dependency.v1
  version: 1.0.0
  summary: Add the fixed suite-preview dependency from issue 201 to issue 202
  stability: experimental
resource:
  kinds: [github_issue_dependency]
  cardinality: one
environment:
  required: true
operation:
  model: typed
  class: mutate
  effects: [update]
input:
  schema:
    type: object
    additionalProperties: false
    properties: {}
output:
  schema:
    type: object
    additionalProperties: false
    required: [changed, relationship, dependency_present, observation_ref, zero_drift]
    properties:
      changed:
        type: boolean
        const: true
      relationship:
        type: string
        enum: [blocks]
        maxLength: 6
      dependency_present:
        type: boolean
        const: true
      observation_ref:
        type: string
        pattern: "^[a-z][a-z0-9_.-]{0,127}$"
        minLength: 1
        maxLength: 128
      zero_drift:
        type: boolean
        const: true
risk:
  level: high
  data_classes: [synthetic_project_metadata]
mutation:
  mode: planned
  destructive: false
approval:
  mode: explicit
execution:
  timeout_ms: 120000
  max_attempts: 1
  concurrency: exclusive_scope
  max_input_bytes: 2
  max_output_bytes: 1024
idempotency:
  classification: keyed
  key: required
retry:
  policy: never
verification:
  mode: required
  postconditions:
    - projects_dependency_201_blocks_202_present
    - projects_fresh_zero_drift
rollback:
  mode: unavailable
  rationale: Accepted Projects contracts do not authorize dependency removal.
  recovery: Preserve the effect outcome and use separately governed sandbox teardown.
  stop_conditions:
    - dependency state is unknown or cannot be independently observed
    - teardown authority or final-state verification is unavailable
    - any reverse mutation would be required
errors:
  taxonomy_version: 1
```

The request must name exactly capability version `1.0.0`, logical resource
`preview_effect_b_dependency_201_blocks_202`, logical environment
`suite_preview_sandbox`, and input `{}`. It cannot supply or override either
issue, repository, Project, relationship direction, provider mode, policy,
approval, plan, target, credential, endpoint, query, mutation document,
postcondition, or teardown.

Success requires `changed: true`, `relationship: blocks`,
`dependency_present: true`, `zero_drift: true`, and both registered
postconditions. The canonical postcondition digest must exact-match
`effectBPostconditionBinding` in both Effect B approvals and bridge.

Prior convergence produces no consequential Effect B plan and cannot be
presented as the required effect execution.

Rollback is unavailable. Accepted Projects contracts do not authorize
`remove_dependency`, and source rollback is never provider-state rollback.
Teardown is owned by the separately governed sandbox boundary; it is not an MCP
capability, Projects plan, compensation, or automatic response to failure.

## Planning and authorization

Planning and apply use distinct RFC-0002 requests, evaluations, decisions, and
one-shot enforcement receipts.

Planning proceeds only after:

1. the authenticated MCP subject is derived server-side;
2. the exact definition, profile, environment, resource, and empty input
   validate;
3. trusted resolvers produce the fixed invented target binding;
4. a current policy bundle explicitly allows planning;
5. every constraint and obligation is enforceable; and
6. a read-only Projects adapter proves issues `201` and `202` are distinct,
   belong to the same invented repository, the dependency is absent, and adding
   it cannot create a cycle.

Any deny, missing allow, stale data, unknown field, dependency failure,
conflicting constraint, unsupported obligation, or indeterminate result denies
with zero provider calls.

The MCP planner creates `B-MCP` with one fixed update step. Its operation digest
binds the definition, profile, empty input, fixed target, policy, Accepted
Projects contract authority, future producer/wrapper/verifier artifact digests,
nested plan `B-Projects`, exact one-operation digest, target snapshot,
Coordination epoch, verifier identities, and postcondition.

`B-Projects` must be fresh, executable, diagnostic-free, and contain exactly:

```text
add_dependency(201 blocks 202)
```

Any field, schema, option, parent, Issue Type, second relationship, reversed
relationship, different issue, caller-selected operation, delete, archive,
batch, or second target invalidates both plans.

Immediately before provider start, MCP obtains and enforces a fresh distinct
apply authorization decision over the same exact bindings. Authentication,
discovery, planning allow, approval, bridge possession, materialization,
Coordination, credentials, workflow admission, or wrapper availability cannot
substitute for that decision.

## Compound approval and bridge

Effect B admission requires all three independently authenticated artifacts:

1. MCP `ApprovalReceiptV1` for `B-MCP`;
2. unchanged Projects `SignedApprovalEnvelope` v1 for `B-Projects`; and
3. authenticated `yukh-projects-approval-bridge-v2`.

The MCP approval is verified only by the MCP-selected approval adapter and
trust profile. The Projects approval is verified only by the Projects-selected
v1 verifier and trust profile. Their subjects, authentication contexts,
schemas, signers, trust roots, nonces, verification receipts, and authority
remain distinct.

The bridge contract is accepted at
`nomed/yukh-projects@521be0d0ef1297579e84a6322dea29f80c2549dc`.
Its closed wire schema, canonicalization, Ed25519 authentication, 32 KiB size
limit, six-object depth limit, 15-minute maximum lifetime, exact field set,
replay rules, and stable failures are authoritative. MCP must not invent,
extend, translate, wrap, or partially validate it.

The bridge exact-matches at least:

- both approval and plan digests;
- both ordered operation-set digests;
- authenticated MCP subject and context;
- host-attested Projects principal;
- fixed target and postcondition binding;
- producer, wrapper, MCP verifier, target-profile, and policy digests;
- distinct MCP and Projects nonce bindings;
- Projects lease scope, holder, and Coordination epoch;
- environment, protected environment, issuer, subject, trust root, and expiry.

The bridge is evidence, not approval, authorization, credential, lease
capability, provider result, or permission to invoke either component. Any
missing, stale, replayed, substituted, incomparable, noncanonical, unauthenticated,
or mismatched artifact denies before provider access.

## Wrapper contract and artifact blocker

The Accepted MCP-safe wrapper contract exposes only:

```typescript
runMcpEffectBControlledApplyV1(
  invocation: McpEffectBControlledApplyInvocationV1,
): Promise<McpEffectBControlledApplyResultV1>
```

Its private invocation consists only of one-attempt, host-created,
nonserializable, nonenumerable, single-use handles for verified MCP admission,
Projects approval and trust, bridge and trust, protected capsule, distinct read
and write credentials, and abort.

The immutable wrapper release must fix capability
`projects.add-dependency.v1`, profile
`yukh-mcp/suite-preview-effect-b-add-dependency-v1`, the exact target, one
`add_dependency(201 blocks 202)` operation, policy, producer, bridge, MCP
verifier, transports, and result mapping. No caller may select a repository,
Project, issue, relationship, operation, mode, provider, credential, endpoint,
URL, query, document, verifier, or transport.

The contract owns the reviewed sequence:

1. verify the MCP approval and mint a single-use verified handle;
2. authenticate and exact-match bridge v2;
3. call `verifySignedApproval` on the unchanged Projects v1 assertion before
   any provider-backed host construction;
4. parse the protected capsule;
5. require `apply-explicitly-enabled`, approved kind `add_blocked_by`, and
   one-operation ceilings;
6. create the fixed controlled-apply host once;
7. exact-match the fresh one-operation plan;
8. call `runApplyEntrypoint` once; and
9. close every private handle without rewriting the effect outcome.

MCP may invoke only a future immutable implementation of that wrapper. It may
not call Projects primitives directly or use a CLI, Action runner, workflow
dispatcher, shell, dynamic import, package installer, generic HTTP client,
GitHub SDK, GraphQL client, or REST client.

The pinned Projects commit accepts this contract but explicitly adds no
executable export or release artifact. Implementation remains blocked until a
separately reviewed Projects change publishes:

- immutable bridge-verifier and wrapper source commits;
- lowercase SHA-256 artifact digests;
- protected-build provenance and SPDX SBOM;
- reproducible-build evidence;
- pinned producer, MCP verifier, target-profile, policy, and toolchain
  bindings;
- canonical and adversarial conformance vectors;
- zero-provider-call evidence for every admission failure;
- one-attempt and durable `completion_unknown` evidence; and
- bounded redaction evidence.

RFC-0011 must pin those published values before any implementation review.

## OIDC and credentials

This proposal preserves the suite's one-shot OIDC shape as a future deployment
constraint only. It creates no OIDC trust, workflow permission, materializer,
credential, or endpoint.

A later accepted deployment record must fix the workflow, commit, protected
environment, repository identity, audience, materializer trust, package
schema, issuers, permissions, expiry, and teardown. One atomic package may
contain distinct short-lived read and write handles plus the exact approvals,
bridge, trust material, capsule, and receipt. Retrieval grants no
authorization, may not retry, and cannot trigger provider execution.

Secrets, assertions, bridge bytes, trust material, capsules, packages,
credentials, endpoints, and provider identifiers remain excluded from
repository input, environment variables, command arguments, workflow output,
artifacts, caches, summaries, logs, errors, audit, and model context.

## Coordination, durable admission, and audit

Projects remains the sole consumer of the Projects approval nonce and sole
owner of the repository-Project-issue fenced lease. MCP consumes only its
distinct nonce and must not acquire a competing lease.

Before provider start, MCP durably commits:

- request and planning authorization evidence;
- plan creation;
- approval request and verification;
- bridge verification;
- fresh apply authorization evidence;
- apply admission; and
- the exact execution-attempt reservation.

The reservation binds the package receipt, both approval and nonce digests,
bridge digest, Coordination epoch and lease digests, producer/wrapper/verifier
artifact digests, both plans and operation sets, postcondition, target, and
Effect A/B disjointness evidence.

If existing RFC-0004 schemas cannot carry a required binding without omission,
implementation is blocked pending a separately accepted registry extension.
Audit unavailability before provider start denies with zero provider calls.
Audit failure after possible effect withholds success, records durable
`completion_unknown`, and never retries.

Evidence contains only allowlisted references, digests, states, stable reason
codes, counts, and duration buckets. It excludes private identifiers, raw
artifacts, target content, provider observations, queries, responses, errors,
and timestamps.

## Independent verification

Projects controlled apply performs its accepted targeted verification and
fresh final zero-operation reconciliation. That result is still only a provider
observation to MCP.

After `effect_observed`, a separate MCP read-only verifier:

1. re-resolves the fixed invented Effect B target;
2. obtains a fresh observation independent of provider output;
3. proves dependency `201 blocks 202` is present;
4. reruns the Accepted Projects planner against the fixed policy;
5. requires zero operations and zero diagnostics;
6. exact-matches the canonical `effectBPostconditionBinding`;
7. binds evidence to the execution, both plans, fresh authorization, producer,
   wrapper, and verifier digests; and
8. releases success only after terminal durable audit commit.

Missing, stale, substituted, malformed, conflicting, unavailable, or nonzero
verification is `verification_failed` or operator review. Provider
acknowledgement cannot substitute for either verification chain.

## Completion unknown, rollback, and teardown

The effect boundary begins immediately before the future immutable wrapper may
construct provider-backed transports. Abort, crash, timeout, process restart,
lost response, producer ambiguity, Coordination ambiguity, lease loss, cleanup
failure, audit failure, or conflicting observations after that boundary yield
`completion_unknown` unless independent evidence proves effect or no effect.

`completion_unknown` is durable and terminal for the reservation. Exact replay
returns the stored unknown outcome without another provider call. The system
must not retry, resume, redispatch, issue replacement intent for the unresolved
effect, remove the dependency, or trigger teardown automatically.

Rollback is unavailable because Accepted Projects contracts do not authorize
dependency removal. Operator reconciliation is read-only. Accepted preview
teardown is a distinct sandbox-owner lifecycle outside both Projects and MCP
effect authority. It requires separate authorization and independent final
state verification, does not rewrite the effect result, and cannot prove an
unknown effect did not occur.

## Stable failure mapping

| Condition | Public result | Provider calls |
| --- | --- | --- |
| unknown, undisclosed, or unaccepted capability | `capability_not_found` | 0 |
| malformed input or wrong fixed binding | `schema_validation_failed` | 0 |
| authorization deny or no explicit allow | `authorization_denied` | 0 |
| policy, identity, attribute, or obligation unavailable | `authorization_unavailable` | 0 |
| stale or substituted plan, target, producer, wrapper, operation, or postcondition | `plan_invalidated` | 0 |
| missing, rejected, expired, or mismatched MCP approval | `approval_required` or `approval_denied` | 0 |
| invalid Projects approval or bridge | `approval_denied` | 0 |
| package unavailable, invalid, replayed, or ambiguous | `authorization_unavailable` | 0 |
| reservation conflict or duplicate before start | `apply_already_reserved` | 0 |
| audit unavailable before start | `audit_unavailable` | 0 |
| producer proves rejection before possible mutation | `provider_protocol_error` | 0 |
| possible effect with unknown outcome | `operation_outcome_unknown` | at most 1 |
| independent dependency or zero-drift verification failure | `verification_failed` | at most 1 |
| rollback requested | `rollback_unavailable` | 0 |

Raw dependency text and dependency identifiers are never retained in public
errors or evidence.

## Threat analysis

Proposed boundaries include authenticated MCP subject to policy, both plans to
their independent approvals, all three artifacts to bridge validation,
protected workflow to materializer, private package to runtime handles, MCP
admission to durable stores, protected capsule to Coordination, MCP adapter to
the future immutable wrapper, distinct credentials to fixed transports,
Projects state to independent verification, and effect outcome to separate
teardown governance.

Primary threats are status-operation remnants, Effect A/B authority collapse,
relationship reversal, issue substitution, second-operation widening,
assertion-schema confusion, one assertion authorizing another, bridge replay,
principal substitution, wrapper replacement, direct primitive composition,
arbitrary network construction, nonce duplication, stale fencing, audit bypass,
provider output treated as success, unsafe retry, reverse mutation presented as
rollback, effect authority triggering teardown, and evidence disclosure.

Controls are exact Accepted semantics, empty input, server-owned fixed target,
two fresh explicit authorizations, separately authenticated approvals,
Accepted bridge v2, immutable artifact pinning, one-shot private handles,
distinct credentials and nonces, producer-owned lease, durable
audit-before-effect, one request, independent dependency and zero-drift
verification, durable unknown completion, unavailable rollback, separately
authorized teardown, and structural redaction.

Residual risks include compromise of GitHub, identity or approval authorities,
materializer, Coordination deployment, future artifacts, sandbox host, runner,
trust roots, DNS/TLS, or synthetic target administrator. Repository-local
stores remain single-process, unwitnessed, and non-production. This proposal
accepts none of those operational risks.

## Compatibility

This revision removes the nonconforming status and restore capability
semantics from Proposed RFC-0011. It does not modify RFC-0001 through RFC-0010
or any Accepted Projects record.

The ordinary gateway continues to discover zero tools, resources, and prompts.
The read-only demo and synthetic setting qualification remain unchanged.

No future implementation may widen this version to another relationship,
direction, issue, Project, repository, environment, operation count, producer,
wrapper, verifier, credential path, retry rule, rollback mode, or teardown
authority. Such a change requires compatibility review and, where authority
expands or semantics break, a new RFC and capability version.

## Validation and acceptance gates

This Proposed record requires a distinct RFC-0007 independent read-only review
on its exact head. The author cannot review, accept, merge, or execute it.

Before RFC-0011 can be considered for acceptance:

1. Projects must separately implement, qualify, and immutably publish the
   Accepted bridge-verifier and wrapper artifacts;
2. RFC-0011 must pin exact source and artifact digests plus provenance,
   conformance, and compatibility evidence;
3. any missing audit-schema binding must receive separate accepted authority;
4. a distinct reviewer must confirm the revised contract and threat delta;
5. all required checks must pass on the exact proposed head; and
6. the applicable acceptance authority must explicitly accept the resulting
   exact RFC text.

Acceptance alone would still authorize no registration, credentials, network,
provider, live mutation, deployment, or readiness. Those require later
separate implementation, deployment, activation, and operational gates.

Future conformance tests must prove:

- canonical definition validation and fixed digest;
- empty input and rejection of every unknown selector;
- exact `projects.add-dependency.v1` identity;
- exactly one `add_dependency(201 blocks 202)` operation;
- no status-setting or dependency-removal path;
- Effect A/B disjointness;
- separate approval verification and bridge exact matching;
- zero provider calls for every pre-effect denial;
- immutable wrapper selection and absence of direct primitive, CLI, shell,
  workflow, generic network, GraphQL, REST, and SDK paths;
- distinct nonces and producer-owned lease;
- one request, no hidden retry, and restart-stable `completion_unknown`;
- independent dependency-presence and fresh zero-drift verification;
- rollback unavailable and teardown outside effect authority; and
- bounded redaction.

No test may use a credential, provider endpoint, GitHub request, workflow apply,
consumer data, or live sandbox.

## Rollout

1. Review this Proposed revision and threat-model delta.
2. Obtain the required independent read-only review on the exact head.
3. Wait for separately reviewed immutable Projects implementation artifacts.
4. Pin those artifacts in a later RFC-0011 revision.
5. Obtain explicit acceptance of that exact revision.
6. Open a separate implementation issue only after acceptance.
7. Keep any skeleton unreachable, disabled, and network-free until later gates.
8. Require separate deployment and activation authority before discovery.
9. Require fresh exact plans and independent approvals before any live
   synthetic effect.
10. Govern teardown and operational readiness independently.

Before acceptance, rollback is closing or revising this proposal. Source
reversion never changes provider state.

## Alternatives

### Keep the status operation

Rejected. It conflicts with Accepted Projects
`add_dependency(201 blocks 202)` semantics and expands authority.

### Treat status and dependency operations as aliases

Rejected. They have different targets, preconditions, plans, postconditions,
provider operations, verification, and teardown implications.

### Add a dependency-removal restore capability

Rejected. Accepted Projects contracts authorize no reverse mutation. Rollback
is unavailable; teardown is separate sandbox-owner authority.

### Expose a generic relationship update

Rejected. Caller-selected issues, direction, or operation would create a broad
mutation capability.

### Dispatch a workflow or compose Projects primitives in MCP

Rejected. Both create unreviewed authority and bypass the Accepted wrapper
contract.

### Trust provider success as MCP verification

Rejected. Effect B requires independent MCP observation and the shared
canonical postcondition.

## Open questions

The owner or applicable future acceptance authority must decide:

1. whether the exact capability definition is accepted after artifacts exist;
2. whether published bridge-verifier, wrapper, MCP verifier, producer, policy,
   and target-profile artifacts preserve both authority boundaries;
3. whether RFC-0004 schemas represent every required obligation receipt;
4. whether repository-local audit and reservation profiles are sufficient for
   an ephemeral qualification;
5. which deployment profile owns OIDC, materializer, trust, Coordination,
   verifier, workflow, target, credentials, endpoint, and network; and
6. which exact operational evidence is required before any activation.

No open question may be resolved by implementation under this Proposed record.
