# Project charter

## Mission

Give an authenticated subject a typed, policy-governed capability for one
explicit resource and environment. Keep credentials behind the provider
boundary and return structured evidence of the decision and verified outcome.

Authentication never grants a capability. Missing, invalid, uncertain, stale,
or unavailable authorization information resolves to deny.

## Scope

Foundation proves four bounded behaviors:

1. discover an allowed capability;
2. inspect a configured local node through `node.inspect`;
3. deny an unauthorized resource before provider invocation;
4. correlate request, decision, result, verification, and redacted evidence.

Yukh MCP is not a shell broker, credential vault, orchestrator, project tracker,
coordination relay, or conversational approval mechanism.

## Operating rules

- Clients select only published, versioned capabilities.
- The server binds subject, action, resource, environment, and current policy.
- Providers receive bounded authority; clients never receive credentials.
- Mutations require an inspectable plan and any plan-bound approval.
- Verification checks declared postconditions independently from execution.
- Evidence is structured and redacted; raw prompts and secrets are excluded.

## Design gate

Every public capability or boundary change must pass these questions:

| Requirement | Acceptance question |
| --- | --- |
| Capability, not custody | Does the operation avoid credentials and unrestricted command text? |
| Deny by default | Does uncertainty stop before provider invocation? |
| Typed and bounded | Are input, output, scope, time, retries, and failures explicit? |
| Plan before mutation | Are effects and preconditions inspectable before apply? |
| Specific approval | Is approval bound to the exact plan, identity, target, and policy? |
| Verification | Are postconditions distinct from execution success? |
| Safe failure | Are partial effects, retry, rollback, and stop conditions explicit? |
| Redacted evidence | Can an investigation proceed without prompts or secrets? |
| Vendor neutrality | Does the public contract avoid provider-specific authority? |
| Reviewable evolution | Do trust-boundary changes have an RFC and threat review? |

An unproven answer blocks acceptance.

## Terms

**Capability**
: A named, versioned operation with typed input, output, scope, risk, timeout,
  retry, verification, and rollback semantics.

**Provider**
: A server-side adapter that translates an authorized capability into bounded
  target operations. It does not decide authorization.

**Plan**
: An immutable description of intended effects, preconditions, bindings,
  validity, verification, and rollback behavior.

**Approval**
: Permission to apply one exact plan. It is neither transferable nor replayable.

**Verification**
: Evaluation of declared postconditions, separate from execution success.

**Evidence**
: Correlated, redacted records of request, decision, execution, and verification.

## Yukh boundary

Yukh MCP governs operational capability. Yukh Projects owns durable delivery
state. Yukh Coordination carries non-authoritative work signals. Neither
project state nor coordination messages grant execution authority.
