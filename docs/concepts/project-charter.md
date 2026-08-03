# Project charter

Yukh MCP gives agents governed capability without giving them custody of
credentials, unrestricted command execution, or infrastructure control.

## Mission

Build a secure, vendor-neutral MCP gateway through which an authenticated
subject can request a typed operation against an explicitly scoped resource and
environment. The gateway evaluates policy, keeps credentials behind the
execution boundary, and returns structured evidence of the decision and the
verified outcome.

"Capability, not custody" is an operational boundary:

- the client selects only a published, versioned capability and supplies input
  that passes its schema;
- the server independently binds subject, action, resource, environment, and
  current policy before a provider is invoked;
- credentials and provider authority remain outside model context;
- a mutation is represented by an inspectable plan before approval or apply;
- approval is bound to the exact plan and target, not to a reusable prompt;
- success requires declared verification evidence, not merely a successful
  process exit;
- decisions and results produce structured, redacted audit evidence.

Authentication alone never grants a capability. Missing, uncertain, invalid,
or unavailable authorization information resolves to deny.

## Audience

Yukh MCP is intended for:

- operators who need to let agents inspect or change bounded resources without
  disclosing infrastructure credentials;
- platform teams that need one policy and evidence boundary across multiple
  vendors or execution providers;
- capability authors who need typed, versioned contracts with explicit risk,
  retry, verification, and rollback semantics;
- auditors and reviewers who need to reconstruct what was requested, allowed,
  executed, and verified without retaining raw prompts or secrets.

## Primary use cases

The Foundation milestone covers only production-shaped, bounded behavior:

1. Discover the capabilities authorized for a subject and environment.
2. Inspect a configured local node through a typed, read-only provider.
3. Observe a deterministic denial for an unauthorized or out-of-scope request.
4. Correlate the request, policy decision, provider result, and verification
   evidence without exposing credentials or sensitive output.

Later milestones may introduce bounded mutations, remote-node providers, and a
provider SDK only after their contracts, trust boundaries, and failure semantics
have been reviewed.

## Non-goals

Yukh MCP is not:

- an unrestricted shell, command proxy, or generic remote administration
  surface;
- a credential vault exposed to models or prompts;
- a replacement for configuration management, orchestration, or provider-native
  control planes;
- a system in which authentication implies authorization;
- an approval mechanism implemented only through conversational consent;
- an agent supervisor, task scheduler, project tracker, or coordination relay;
- a system that equates provider acceptance or exit code zero with verified
  success.

## Design-review principles

Every proposed public capability or boundary change must answer these questions.
A negative or unproven answer blocks acceptance.

| Principle | Review question |
| --- | --- |
| Capability, not custody | Can the operation be invoked without exposing credentials or accepting unrestricted command text? |
| Deny by default | Are subject, action, resource, environment, and policy evaluated server-side, with uncertainty resolving to deny? |
| Typed and bounded | Are input, output, scope, time, resource use, and failure behavior explicitly bounded? |
| Plan before mutation | Is every prospective effect represented by an immutable, inspectable plan before apply? |
| Approval is specific | Is required approval bound to the exact identity, plan, target, policy decision, and validity window? |
| Verify the outcome | Are postconditions declared and evaluated independently from execution success? |
| Safe failure | Are retries, idempotency, partial failure, rollback, and destructive-operation stop conditions explicit? |
| Evidence without secrets | Can an investigation correlate intent, decision, execution, and verification using redacted structured records? |
| Vendor neutrality | Does the public contract describe domain behavior without leaking provider-specific authority into clients? |
| Reviewable evolution | Does a public-contract or trust-boundary change have the required RFC and threat-model update? |

## Terms

**Capability**
: A named, versioned, typed operation with explicit scope, risk, mutation,
  policy, timeout, retry, verification, and rollback semantics.

**Provider**
: A server-side adapter that translates an authorized capability into bounded
  target-specific operations. A provider does not decide authorization.

**Node**
: A resource endpoint that a provider may inspect or operate on within an
  explicitly configured scope. A node is not implicitly trusted or authorized.

**Plan**
: An immutable description of intended effects, preconditions, target, policy
  binding, validity window, verification requirements, and applicable rollback
  behavior.

**Approval**
: An explicit authorization to apply one exact plan under its bound identity,
  target, policy decision, and validity conditions. It is not transferable or
  replayable.

**Verification**
: Evaluation of declared postconditions using evidence distinct from the fact
  that execution was attempted or accepted.

**Evidence**
: Structured, correlated, redacted records that explain the request, decision,
  plan, execution result, and verification result without retaining secrets or
  raw private reasoning.

## Relationship to the Yukh system

Yukh MCP governs operational capabilities. Yukh Projects reconciles roadmap and
delivery state. Yukh Coordination makes cross-session work legible. They may
integrate through explicit contracts, but none owns the others and neither
project state nor coordination statements grant execution authority.
