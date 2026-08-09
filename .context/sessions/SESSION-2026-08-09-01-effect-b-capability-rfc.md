# Session - Effect B capability contract gate

- Date: 2026-08-09
- Governing issue: https://github.com/nomed/yukh-mcp/issues/96
- Suite mission: accepted `nomed/nomed.github.io` RFC-0005 at
  `12d9215f10c4b7fb1762a5025367e3e81543800f`
- Autonomous mandate: accepted `nomed/nomed.github.io` RFC-0007 at
  `bb8628edf7a07c2af56f07e4f9140f58c851ef47`
- Projects authority:
  `nomed/yukh-projects@521be0d0ef1297579e84a6322dea29f80c2549dc`
- Status: Proposed component RFC; Accepted upstream specification exists,
  executable bridge and wrapper artifacts remain unpublished

## Objective

Advance accepted suite Effect B only to a conforming Yukh MCP contract-review
gate.

## Author decision

Accepted Projects effects v1 fixes capability `projects.add-dependency.v1` and
exactly one `add_dependency(201 blocks 202)` operation. Earlier Proposed
RFC-0011 used a conflicting status operation.

Under RFC-0007, the author selects the Accepted Projects semantic because it
has least authority expansion, decisive already-Accepted semantics, compatible
plans and approvals, reversible change to a Proposed record, and the smallest
authority delta. The exact immutable author record is posted to issue #96.
This session does not review, accept, merge, implement, or activate the change.

## Revised proposed contract

RFC-0011 now proposes:

- `projects.add-dependency.v1@1.0.0` for the fixed invented dependency
  `201 blocks 202`;
- one exact `add_dependency` operation and canonical
  `effectBPostconditionBinding`;
- separate MCP and Projects approvals plus Accepted authenticated
  `yukh-projects-approval-bridge-v2`;
- the Accepted `runMcpEffectBControlledApplyV1` wrapper contract;
- no direct Projects primitive composition;
- durable audit, one attempt, independent verification, and
  `completion_unknown`;
- unavailable rollback because dependency removal is not accepted; and
- separately governed sandbox teardown outside MCP and Projects effect
  authority.

## Context impact

This non-authoritative session record navigates the Proposed RFC and accepted
upstream authorities. It creates no runtime, registry, gateway, identity,
credential, OIDC, endpoint, network, provider, mutation, teardown, deployment,
release, or readiness behavior.

The Project 5 / issue 27 profile remains separate and unchanged.

## Required next gate

1. Distinct RFC-0007 read-only review of the exact PR head.
2. Separate Projects implementation and immutable publication of the accepted
   bridge-verifier and MCP-safe wrapper artifacts.
3. RFC-0011 revision pinning exact source and artifact digests.
4. Explicit acceptance of that exact RFC revision.
5. Separate implementation, deployment, activation, live-effect, teardown, and
   readiness gates.
