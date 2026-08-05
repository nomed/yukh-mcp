# RFC-0007 — Protected Yukh Projects controlled-apply boundary

- Status: Accepted
- Authors: Codex
- Created: 2026-08-05
- Accepted: 2026-08-05
- Decider: project owner
- Governing issue: https://github.com/nomed/yukh-mcp/issues/70
- Depends on: RFC-0002, RFC-0003, RFC-0004, RFC-0005, RFC-0006
- Blocked by: https://github.com/nomed/yukh-projects/issues/131
- Producer baseline: `nomed/yukh-projects v1.6.0` at `aa1c3e0acde5618b7895ecd971b308a08b55219b`

Acceptance authorizes only a separately reviewed inert workflow contract,
materializer interface and synthetic tests. It would not authorize an Actions
environment, identity federation, broker, credential, approval issuance,
Coordination endpoint, provider request, live apply, deployment, backfill,
legacy removal or migration completion.

The project owner explicitly accepted this RFC and the blocking
`nomed/yukh-projects#131` contract on 2026-08-05. Acceptance does not authorize
implementation in this PR or any operational authority excluded above.

## Summary

Define the first consumer boundary for `yukh-projects` controlled apply as two
independent manual workflows: a read-only planning workflow and a protected
single-attempt apply workflow. A plan never starts apply. Between the workflows,
an independent approval authority authenticates a human and signs the exact
fresh plan. The apply job obtains one run-bound, short-lived material package
through GitHub OIDC from a fixed trusted materializer.

The package contains distinct GitHub read and write credentials, the already
issued approval envelope, its separately configured trust root and one
short-lived Yukh Projects host capsule. It is written only to exclusive runtime
files, consumed once and removed in an unconditional cleanup step. No static
secret, private signing key or reusable credential is stored in the repository,
workflow inputs, Actions artifacts, cache, outputs or logs.

The first profile is fixed to `nomed/yukh-mcp`, Project 5, issue #27, exact mode
`legacy-apply-v1` and one protected environment. General scopes or batch apply
require a future RFC.

## Motivation

The qualified v1.6.0 shadow proves deterministic planning with GraphQL budget
zero, but it supplies no mutation authority. The producer apply Action requires
separate credentials, a signed approval, nonce replay protection, a fenced
lease and a host capsule containing Coordination authority. GitHub environment
review alone is not cryptographic plan approval, and static repository or
environment secrets cannot safely represent a fifteen-minute run-bound package.

Without a consumer contract, an apparently small workflow could accidentally:

- turn a workflow dispatch, issue comment or environment approval into apply
  authority;
- expose or reuse credentials, approval material, a DPoP key or lease authority;
- apply a changed plan or policy commit;
- use the ambient `GITHUB_TOKEN` for provider writes;
- retry after an ambiguous mutation or rerun a consumed approval;
- broaden Project 5 reconciliation into a generic repository mutation tool;
- publish sensitive provider identifiers or runtime material as evidence.

## Goals

- preserve the accepted RFC-0003 plan, approval, apply and verification states;
- keep planning structurally read-only and GraphQL-zero;
- bind one approval to one exact plan, policy commit, subject, scope,
  environment, operation digest, expiry and nonce;
- materialize all runtime authority just in time without long-lived Actions
  secrets;
- invoke only the immutable v1.6.0 apply Action in `legacy-apply-v1` mode;
- retain one request attempt, no polling, no sleep and no hidden retry;
- require fresh re-planning and exact equality before provider authority crosses;
- publish only stable redacted evidence and support immediate disablement;
- retain legacy `nomed/yukh v0.9.1` until a separately approved second pass
  proves zero operations.

## Non-goals

- implement or deploy the materializer, approval authority, GitHub App,
  Coordination service, OIDC trust or Actions environment;
- select a cloud, secret manager, key-management product or operator identity;
- create, sign or approve the current plan;
- make Project status, issue labels, comments, PR reviews or environment review
  an approval assertion;
- authorize provider access, mutation, deployment, rollback execution, field
  removal, batch reconciliation or consumer migration completion;
- import Coordination source, client packages, storage details or credentials;
- generalize the profile beyond the exact first-consumer scope.

## Detailed design

### Fixed profile

The profile identifier is `yukh-mcp/project-5-issue-27-legacy-apply-v1`. Its
immutable producer reference is
`nomed/yukh-projects@aa1c3e0acde5618b7895ecd971b308a08b55219b`.
The workflow fixes owner `nomed`, repository `yukh-mcp`, Project `5`, issue `27`,
policy path `.yukh/project.yaml` and mode `legacy-apply-v1`. Those values are not
dispatch inputs. The protected environment name is fixed in reviewed workflow
source and must also be present in the approval and host capsule.

The workflow permission block is exactly `contents: read` and `id-token: write`.
The ambient `GITHUB_TOKEN` is never passed to Yukh Projects or the materializer.
Provider authority comes only from the two package credentials.

### Phase 1: plan

The existing manual shadow workflow remains the only planner entrypoint. It
checks out one exact `main` commit, runs `legacy-shadow` for issue #27 and emits
the redacted plan ID, operation count and stable diagnostics. It cannot request
an OIDC token, enter the apply environment, read an approval or invoke the apply
bundle.

A successful plan is review evidence only. It does not dispatch the apply
workflow, upload private observations or create an approval. A changed policy,
producer pin or target observation requires a new plan.

### Phase 2: independent approval

An approval authority outside the workflow authenticates the approver and
issues the producer's canonical Ed25519 envelope for the exact plan. It binds at
least the issuer and subject references, repository, Project, issue, policy
commit, producer and contract versions, plan ID, ordered operation-set digest,
environment, issue and expiry times, and a unique nonce. Maximum validity is
fifteen minutes.

The approval private key never reaches GitHub Actions or the materializer. The
trust-root public key is selected by materializer policy, not repository content
or the approval envelope. GitHub environment review is an additional job
admission control and never satisfies this phase.

### Phase 3: protected materialization

Apply is a separate `workflow_dispatch` with only the lowercase plan digest and
exact approved policy commit as bounded inputs. The job requires the fixed
protected environment, one concurrency group for Project 5 issue #27,
`cancel-in-progress: false`, `timeout-minutes: 10` and `run_attempt == 1`.

A pinned, repository-owned materializer step requests one GitHub OIDC token with
an exact audience. It performs one direct TLS exchange with a fixed configured
origin. The materializer verifies repository ID, workflow ref and digest,
environment, event, run ID, run attempt, policy commit, plan ID and package
expiry. Redirects, proxy discovery, fallback identity, polling, refresh and
retry are forbidden.

The returned closed package is bound to that run and contains:

1. a short-lived read-only GitHub credential;
2. a distinct least-privilege write credential;
3. the previously issued canonical approval envelope;
4. the separately selected Ed25519 public trust root;
5. a canonical host capsule containing exact enablement, scope, rate limits,
   allowlisted mutation kinds, Coordination epoch, short-lived credential and
   ephemeral DPoP private key.

The materializer writes approval and public-key files beneath a private
workspace runtime directory and the capsule beneath `RUNNER_TEMP`, all as
non-symlink regular files with mode `0600`. It registers both GitHub credentials
with the Actions masker before any subsequent step. Raw package bytes and
individual values are never outputs.

The implementation must reject packages over 64 KiB, noncanonical JSON,
unknown fields, mismatched bindings, shared credentials, expiry beyond fifteen
minutes, unapproved mutation kinds, GraphQL reserve below 1,000, REST reserve
below 1,000, more than the reviewed request ceilings or a reusable package
receipt. Retrieval is atomic and one-shot; ambiguous retrieval stops the run.

The current four-operation plan requires one REST mutation and three GraphQL
mutations. Producer v1.6.0 caps a run at two GraphQL requests, so it would defer
before the final mutation after earlier effects could already exist. RFC-0007
implementation is therefore blocked on `yukh-projects#131`: the producer must
pre-admit the complete operation graph against exact request/point ceilings and
an immutable successor must qualify the three-request plan before the first
consumer apply can be prepared. The consumer must not split, partially approve
or sequentially re-plan subsets to bypass this gate.

### Phase 4: apply and verification

The job checks out the exact approved policy commit without persisted checkout
credentials and invokes only the immutable producer apply Action with the exact
mode and fixed scope. It passes the distinct masked credentials, approved plan
ID, protected file paths, environment and capsule basename. No shell constructs
provider requests or approval claims.

The producer must freshly observe and recreate the same plan before mutation.
Any mismatch, budget deferral, unavailable Coordination primitive, replay,
lease contention or loss, permission mismatch, provider ambiguity,
verification failure or remaining drift stops without retry. Success requires
the producer's final zero-operation observation.

One successful first apply does not remove legacy automation. A second apply
requires a new plan, independently issued approval, new nonce and new package;
it must report zero mutations. That second run and legacy removal each require
separate owner authorization.

### Cleanup and evidence

An unconditional finalizer overwrites in-memory references where supported and
removes every runtime file. Cleanup failure is reported as a stable invariant
failure but cannot reverse or conceal an already attempted effect. GitHub-hosted
runner teardown is defense in depth, not proof of erasure.

Public outputs are limited to status, plan digest, aggregate counts, remaining
drift and stable diagnostic codes. Artifacts, caches and step summaries must not
contain tokens, approval contents, keys, capsule data, nonces, provider bodies,
provider IDs, ETags, URLs, private observations or timestamps. Protected audit
integration remains governed by RFC-0004 and cannot be fabricated from Actions
logs.

## Trust boundaries and threat analysis

| Threat | Required control | Residual risk |
| --- | --- | --- |
| workflow dispatch treated as approval | independent signed envelope plus exact fresh-plan equality | compromise of approval authority remains deployment-specific |
| environment reviewer becomes approval authority | environment is job admission only and is absent from approval verification logic | GitHub administrator can still disable repository controls |
| OIDC or package replay | exact run/repository/workflow/environment/commit/plan binding, `run_attempt == 1`, atomic one-shot receipt | broker and GitHub identity compromise remain trusted dependencies |
| credential confusion or excess authority | separate audience-bound installation credentials and exact permission attestation | GitHub permission semantics require deployment qualification |
| package or secret disclosure | closed bounded response, immediate masking, exclusive files, no outputs/artifacts/cache | runtime or hosted-runner compromise can observe process memory |
| approval or policy substitution | signature, trust-root fingerprint, policy commit and operation digest all bind exactly | approver may authorize an undesirable but accurately represented plan |
| unsafe retry after ambiguity | workflow and producer each attempt once; reruns fail on run attempt and nonce receipt | operator reconciliation is required after unknown completion |
| rate exhaustion | GraphQL-zero planning, declared reserves, bounded request ceilings and fail-closed deferral | provider may change limits or return unavailable metadata |
| plan fits approval but not the run budget | complete pre-admission of every REST/GraphQL operation before the first mutation; `yukh-projects#131` blocks implementation | a provider cost change still requires a fresh plan and profile qualification |
| lease or nonce failure | accepted Coordination adapter semantics and short-lived DPoP package | real endpoint availability and custody require separate qualification |
| misleading success | fresh targeted verification and final zero-operation plan | provider observation integrity remains an external dependency |

## Compatibility

The existing shadow workflow, legacy workflows and inert MCP runtime remain
unchanged. RFC-0007 consumes public v1.6.0 producer and accepted Coordination
contracts without importing either implementation. It adds no MCP capability or
gateway provider surface.

## Rollout and rollback

1. Accept this RFC explicitly.
2. Implement only the inert workflow shape, closed materializer interface,
   synthetic package fixtures and negative tests in a reviewable PR.
3. Separately qualify and provision the approval authority, OIDC trust,
   materializer, GitHub App profiles, protected environment and Coordination
   endpoint. No values enter repository history.
4. Produce a fresh shadow and approval, then request explicit authorization for
   exactly one live apply.
5. After verified convergence, request a separate zero-operation second apply.
6. Remove legacy automation only after separately accepted migration evidence.

Emergency disablement removes environment access and materializer policy. The
read-only rollback pin is `yukh-projects v1.5.1` at
`d58837397bc5856923e0e742458be34d8e5a27d6`; legacy `nomed/yukh v0.9.1` remains
installed until completion. Neither rollback pin reverses additive Project
state or authorizes a compensating mutation.

## Alternatives

- **Static Actions or environment secrets:** rejected because approval, DPoP
  key, capsule and installation credentials are short-lived and run-bound.
- **Use `GITHUB_TOKEN` for both reads and writes:** rejected because authority
  and credential profiles must remain distinct and Project scope is unsuitable.
- **Treat environment review or issue approval as the signed assertion:**
  rejected because neither binds the canonical plan and operation digest.
- **Self-hosted runner preloaded with credentials:** rejected for the first
  profile because it adds host persistence and operator boundaries without
  removing the need for run-bound materialization.
- **Pass a sealed package as an Actions artifact:** rejected because artifacts
  are retained objects with broader retrieval and replay surfaces.
- **Invoke the producer CLI from shell:** rejected because the immutable Action
  provides the narrower reviewed interface and masking behavior.

## Open questions

- Which independent approval identity and key-custody profile will be proposed?
- Which fixed materializer origin and workload identity policy will be qualified?
- Which GitHub App installations provide the exact read and write profiles for
  a user-owned repository and user-owned Project?
- Which accepted Coordination deployment profile supplies the host capsule?
- What protected audit writer satisfies RFC-0004 for a real mutation?

Each answer changes an operational trust boundary and requires separate review.
