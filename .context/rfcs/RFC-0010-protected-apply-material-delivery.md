# RFC-0010 — Protected apply material delivery

- Status: Proposed
- Authors: Codex
- Created: 2026-08-06
- Governing issue: https://github.com/nomed/yukh-mcp/issues/82
- Depends on: RFC-0003, RFC-0004, RFC-0005, RFC-0007, RFC-0008, RFC-0009

## Summary

Deliver the independently issued approval envelope, its independently selected
Ed25519 trust root, and the expiring Yukh Projects host capsule to the fixed
Project 5 controlled-apply job as three protected GitHub Actions environment
secrets. This is a narrow just-in-time delivery profile for
`yukh-mcp/project-5-issue-27-legacy-apply-v1`; it is not a general secret or
approval service.

The environment secret names are fixed as
`YUKH_PROJECTS_APPROVAL_ENVELOPE`, `YUKH_PROJECTS_APPROVAL_PUBLIC_KEY`, and
`YUKH_PROJECTS_HOST_CAPSULE`. RFC-0009 continues to govern the separate
`YUKH_PROJECTS_WRITE_TOKEN`. Repository source, dispatch inputs, the automatic
`GITHUB_TOKEN`, artifacts, outputs, caches, summaries, and logs are not delivery
channels.

Acceptance authorizes an inert, reviewable workflow implementation and
hermetic tests only. It does not authorize creating or reading any secret,
configuring the environment, issuing an approval or capsule, connecting to
Coordination, enabling the job, invoking a provider, or applying the plan.

## Motivation

Immutable `yukh-projects v1.7.0` supports the accepted single-token provider
profile but still requires an authenticated approval, an independently chosen
trust root, and a host capsule for nonce and fenced-lease authority. RFC-0008
rejected the materializer/OIDC package without replacing these three delivery
paths. Adding producer steps before this gap is closed would either make the
workflow unusable or encourage approval material in unsafe inputs or source.

## Goals

- preserve independent exact-plan approval and protected trust-root selection;
- deliver only fresh, bounded material after protected-environment admission;
- keep the repository job unable to execute until a separate activation review;
- write exclusive runtime files without printing their contents;
- bind the material to the fixed run, plan, policy, environment, and scope;
- remove files unconditionally and expose only stable redacted producer output;
- retain one attempt, no retry, refresh, polling, sleep, fallback, or rerun.

## Non-goals

- define approval policy, approver identity, signing-key custody, or issuance UI;
- deploy or select a production Coordination endpoint;
- configure, retrieve, rotate, validate, or delete real Actions secrets;
- authorize the currently reviewed plan for provider execution;
- enable a workflow, create an environment, mutate Project 5, remove legacy
  automation, deploy MCP, or complete the migration;
- support another repository, Project, issue, mode, producer, or batch.

## Detailed design

### Fixed protected material

The three values exist only as secrets of the fixed
`yukh-projects-controlled-apply` environment. Repository and organization
secrets are rejected for this profile because they may be exposed to a broader
workflow set. The approval envelope and host capsule must be canonical bounded
JSON of at most 64 KiB each. The public key must be one bounded PEM public key
of at most 8 KiB. Empty values, control-character substitution, oversized
values, unknown envelope fields, or malformed material fail before producer
invocation.

The approval and capsule each expire no later than fifteen minutes after
issuance. They bind the exact repository, Project 5, issue #27, protected
environment, approved policy commit, fresh plan ID, operation digest, producer
contract versions, and one unique nonce. The capsule additionally binds the
accepted mutation allowlist, request and point ceilings, reserves of at least
1000, Coordination epoch and expiring Coordination authority. Neither value
may select its own trust root.

The public key is selected by protected-environment administration independently
of repository source and approval contents. It is not confidential, but it is
kept in the same protected boundary so a repository change cannot substitute
the approval authority.

### Inert implementation

The first implementation keeps the existing hard-coded false job condition.
It may add a repository-owned Node materialization helper and the intended
producer/cleanup step graph, but tests must prove the false gate remains ahead
of runner and secret resolution. The producer invocation remains unreachable;
no test may evaluate a real secret expression or contact GitHub Projects or
Coordination.

The later activation PR must be separately authorized. It replaces the false
gate only after environment and secret-name configuration, issuance procedure,
trust-root custody, Coordination profile, permission attestation, immutable
producer checksum, and rollback disablement are reviewed together.

### Runtime custody

After environment admission, protected values are passed only as masked,
step-local environment values to a pinned repository-owned Node helper. The
helper creates a fresh directory beneath `RUNNER_TEMP` with mode `0700`, rejects
links and pre-existing targets, validates bounds and closed schemas, writes
three exclusive regular files with mode `0600`, registers every protected value
with the Actions masker before any other output, and returns only fixed
basenames. It never serializes material to stdout, stderr, command lines,
`GITHUB_OUTPUT`, `GITHUB_ENV`, artifacts, summaries, or caches.

The immutable v1.7.0 apply Action receives the same masked
`YUKH_PROJECTS_WRITE_TOKEN` for its read and write inputs only in
`legacy-single-token-apply-v1`, plus the fixed scope, exact dispatch digests,
protected basenames, and environment. Checkout uses only the automatic
read-only `GITHUB_TOKEN` with persisted credentials disabled; that token never
reaches the producer.

An `always()` cleanup step removes the runtime directory without following
links and reports only a static cleanup status. Cleanup failure cannot convert
an apply result to success or authorize retry. Hosted-runner teardown is
defense in depth, not evidence of erasure.

### Single attempt and evidence

`run_attempt == 1`, fixed concurrency with cancellation disabled, and the
ten-minute job deadline remain mandatory. A failed, deferred, ambiguous, or
partially completed run is never rerun or resumed. It requires a fresh shadow,
approval, nonce, capsule, and explicit authorization.

Public evidence is restricted to producer status, plan digest, aggregate
outcome counts, remaining drift, and stable diagnostic codes. Protected values,
claims, signatures, keys, capsule content, nonce, provider identifiers, URLs,
headers, bodies, ETags, cache contents, and timestamps are forbidden.

## Trust boundaries and threat analysis

| Threat | Required control | Residual risk |
| --- | --- | --- |
| dispatch or environment review becomes approval | independently signed exact-plan envelope verified by an independently selected trust root | approver or trust-root administrator compromise remains trusted |
| protected material leaks through Actions channels | environment-only secrets, masking, step-local values, exclusive bounded files, no retained channel, unconditional cleanup | runner or GitHub secret-store compromise can observe material |
| stale secret is replayed | fifteen-minute expiry, exact run bindings, atomic nonce consumption, first attempt only | manual provisioning errors cause safe denial and operational delay |
| repository substitutes the trust root | trust root is an environment secret selected outside repository source and absent from the approval | environment administrator remains trusted |
| capsule widens authority | closed fixed scope, allowlist, ceilings, reserves, epoch and environment validation by the immutable producer | Coordination deployment correctness is separately qualified |
| cleanup or provider ambiguity triggers retry | no retry/rerun/resume; cleanup cannot alter outcome; fresh lifecycle required | additive partial effects may require explicit reconciliation |
| inert code accidentally resolves secrets | hard-coded false job gate plus structural tests requiring zero reachable runner execution | a later reviewed source change can activate the boundary |

## Compatibility

RFC-0007 remains authoritative except where RFC-0008 rejected its
OIDC/materializer delivery. RFC-0008 and RFC-0009 continue to govern the
single provider token. RFC-0010 supplies only the missing approval, trust-root,
and host-capsule delivery path. The shadow workflow and legacy rollback surface
are unchanged.

## Rollout and rollback

1. Accept this RFC and threat-model delta.
2. Implement the still-inert materialization, producer, cleanup, and negative
   tests in a separate PR; do not change the false gate.
3. Separately qualify external environment, issuance, trust, Coordination, and
   secret configuration without provider mutation.
4. Review a fresh shadow plan and authorize one activation PR.
5. Authorize one exact live apply separately.

Before live apply, rollback is deletion or disablement of the protected
environment admission and secrets while the false gate remains. After an
attempt, rollback never means blind compensating mutation: re-observe and begin
a fresh governed lifecycle.

## Alternatives

- **Workflow inputs or repository files:** rejected because dispatch history and
  source are disclosure and substitution channels.
- **Artifacts or caches:** rejected because they are retained and insufficiently
  bound to protected environment admission.
- **Automatic `GITHUB_TOKEN`:** rejected because it is checkout authority, not
  approval, Coordination, or provider authority.
- **Restore OIDC/materializer:** rejected by RFC-0008 for this fixed profile.
- **Remove approval or Coordination gates:** rejected because a token and
  environment review do not authorize an exact plan or provide replay fencing.

## Open questions

- Which independent operator provisions and removes the three expiring
  environment secrets for the first qualification?
- Which already reviewed Coordination deployment and epoch will issue the host
  capsule authority?
- What evidence proves environment-secret scope and required-reviewer settings
  without disclosing configuration values?
