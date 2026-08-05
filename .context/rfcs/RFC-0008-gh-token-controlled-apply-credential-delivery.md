# RFC-0008 — GH_TOKEN credential delivery for Project 5 controlled apply

- Status: Accepted
- Authors: project owner
- Created: 2026-08-05
- Accepted: 2026-08-05
- Decider: project owner
- Governing issue: https://github.com/nomed/yukh-mcp/issues/27
- Supersedes: RFC-0007 only for credential delivery
- Depends on: RFC-0002, RFC-0003, RFC-0004, RFC-0005, RFC-0006, RFC-0007

## Summary

Permanently replace the deferred materializer and GitHub OIDC credential
delivery model from RFC-0007 with a GitHub Actions secret named `GH_TOKEN` for
the first controlled-apply profile only:
`yukh-mcp/project-5-issue-27-legacy-apply-v1`.

`GH_TOKEN` must be configured manually as a GitHub Actions secret. It must
never be committed, printed, placed in workflow inputs, outputs, artifacts,
caches, step summaries, logs, repository configuration, or documentation
examples. This RFC does not configure or retrieve the secret.

This RFC supersedes RFC-0007 only where it specifies credential delivery. All
other RFC-0007 controls remain in force: fresh exact planning, independent
approval, fixed scope, one attempt with no retry, verification, redacted
evidence, and separately scoped read and write authority where technically
available.

## Motivation

The deferred materializer/OIDC model introduced additional unavailable
operational dependencies: an identity federation configuration, materializer,
sealed package, approval transport, and Coordination host capsule. The project
owner has permanently selected manually managed GitHub Actions secret delivery
instead. Retaining the former path would leave two conflicting credential
delivery models for the same mutation boundary.

## Goals

- use only the manually configured `GH_TOKEN` secret for future producer
  credential delivery in this profile;
- remove the workflow's OIDC permission while it remains inert;
- preserve the exact profile: `nomed/yukh-mcp`, Project `5`, issue `27`,
  `.yukh/project.yaml`, `legacy-apply-v1`, producer
  `nomed/yukh-projects@e3285c6994edd8fad1666da6ca48386522c9e90f`, and the
  reviewed protected environment;
- retain a fresh, exact plan and an approval independently issued for that
  plan before any mutation;
- keep `run_attempt == 1`, a single request attempt, no polling, sleep,
  self-dispatch, fallback, refresh, or retry;
- require targeted verification and a final zero-operation observation;
- retain only redacted, allowlisted evidence;
- separate checkout read authority from producer authority and preserve
  distinct producer read/write credentials if the reviewed producer interface
  technically supports them.

## Non-goals

- enabling the workflow;
- creating, configuring, retrieving, rotating, or validating `GH_TOKEN`;
- invoking the producer or any provider, applying a plan, or changing Project
  state;
- removing the existing synthetic materializer-package reference implementation;
  it has no permitted workflow or credential-delivery use under this profile;
- treating secret presence, workflow dispatch, issue state, or environment
  approval as independent approval;
- generalizing the profile, adding a batch scope, removing legacy automation,
  or authorizing a second apply.

## Detailed design

### Profile and credential authority

The workflow remains a `workflow_dispatch` contract with exactly the bounded
`plan_digest` and `policy_commit` inputs, fixed concurrency, protected
environment, ten-minute timeout, and a permanently false job condition. It
retains only `contents: read` workflow permission; `id-token: write` is
removed. While inert, it has no steps and accesses no secret.

Before any separately authorized activation, a repository administrator must
manually configure `GH_TOKEN` as a GitHub Actions secret. The value is external
to source control and must not be copied into a file, command line, diagnostic,
or evidence record. A future reviewed activation may pass
`${{ secrets.GH_TOKEN }}` directly to the immutable producer action's supported
credential input, and only for this fixed profile. It must not export the value
as a job or workflow environment variable.

The automatic workflow `GITHUB_TOKEN` remains restricted to `contents: read`
for checkout and must never be passed to the producer. `GH_TOKEN` is the
producer credential for the fixed scope. If the reviewed immutable producer
interface supports independently supplied read and write credentials, they must
remain separately scoped and the activation must preserve that separation. If
that interface accepts only one credential, no claim of independent provider
read/write credentials may be made; the separate read-only checkout authority
remains mandatory.

### Plan, approval, apply, and verification

The existing manual shadow workflow remains the only planner. Before any apply,
the producer must freshly recreate the approved exact plan at the exact approved
policy commit. An approval authority independent of the workflow must approve
the exact plan, ordered operation-set digest, profile, scope, environment,
expiry, and unique nonce. A workflow dispatch, secret, GitHub environment
review, or GitHub issue state is not approval.

The producer is invoked at most once. Any mismatch, expired approval, replay,
scope or permission failure, unavailable dependency, budget deferral, provider
ambiguity, or verification failure stops without retry. Success requires
targeted verification and a final zero-operation observation. Public evidence
is limited to status, plan digest, aggregate counts, remaining drift, and stable
diagnostic codes; it excludes all secret values and sensitive provider data.

## Trust boundaries and threat analysis

`GH_TOKEN` crosses from GitHub's Actions secret store to a future protected
runner only after explicit workflow activation. It is a high-value provider
credential and must be masked by GitHub, supplied only to the reviewed producer
input, and excluded from every retained channel. The GitHub secret store,
protected environment, runner, and producer remain dependencies; compromise of
any may expose or misuse the token.

The former OIDC token, materializer, package receipt, approval-envelope
transport, host capsule, DPoP key, and Coordination credential are no longer
credential-delivery controls for this profile. They must not be reintroduced
through redirects, fallbacks, hidden steps, helper scripts, artifacts, or
runtime files. A future proposal to use them needs a new RFC.

## Compatibility

RFC-0007 remains accepted and governs every control other than credential
delivery. The manual read-only shadow workflow, legacy workflows, ordinary
inert MCP runtime, fixed profile inputs, concurrency, approval semantics, and
verification requirements remain unchanged. This introduces no MCP capability
or provider invocation.

## Rollout and rollback

1. Record this accepted credential-delivery decision and remove OIDC permission
   from the permanently skipped workflow.
2. A repository administrator manually configures `GH_TOKEN` outside source
   control; this RFC does not authorize that action.
3. A separate review must authorize any workflow activation and prove secret
   non-disclosure, fixed scope, independent approval, single-attempt behavior,
   and verification before a provider can be invoked.
4. A separate explicit human authorization is required for one exact live
   apply. A subsequent zero-operation apply and legacy removal each require
   their own authorization.

Emergency disablement keeps the workflow skipped and removes its protected
environment admission or the manually configured secret through repository
administration. It does not authorize a compensating mutation or rollback of
provider state.

## Alternatives

- **Deferred materializer and GitHub OIDC:** permanently rejected for this
  profile by the explicit human decision recorded here.
- **Commit a token or pass it as an input:** rejected because repository
  history, dispatch records, logs, and inputs are disclosure channels.
- **Use the ambient `GITHUB_TOKEN` for the producer:** rejected because its
  read-only checkout authority must remain separate from producer authority.
- **Treat secret availability or environment review as approval:** rejected
  because neither binds an exact fresh plan and operation digest.

## Open questions

- What exact least-privilege permissions and expiry policy will the manually
  configured `GH_TOKEN` use?
- Does the immutable producer interface support independent read and write
  credential inputs for this profile?
- What approval authority and protected audit integration will be qualified
  before any activation?
