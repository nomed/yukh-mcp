# Session - Effect B capability contract gate

- Date: 2026-08-09
- Governing issue: https://github.com/nomed/yukh-mcp/issues/96
- Suite issue: https://github.com/nomed/nomed.github.io/issues/40
- Suite RFC: accepted on `nomed/nomed.github.io` `main` at
  `12d9215f10c4b7fb1762a5025367e3e81543800f` (PR #42)
- Status: Proposed component RFC blocked on `nomed/yukh-projects#150`

## Objective

Advance accepted suite RFC-0005 only to the next reviewable Yukh MCP gate for
Effect B.

## Decision discovered

A new component RFC is required before any capability or provider registration.
RFC-0001 requires registration and threat review; RFC-0006 reserves gateway and
provider wiring for a later RFC; RFC-0007 adds no MCP capability surface; and
RFC-0010 plus the current threat model explicitly forbid provider registration,
Projects apply, credentials, endpoints, and live mutation.

RFC-0011 therefore remains Proposed. This session introduces no runtime,
provider, registry, gateway, workflow, identity, credential, endpoint, network,
mutation, restore, deployment, or readiness behavior.

Independent review established that the strict MCP `ApprovalReceiptV1` and
Yukh Projects `SignedApprovalEnvelope` cannot be one envelope, and that the
immutable v1.7.0 producer exports primitives rather than one reviewed MCP-safe
wrapper. Issue `nomed/yukh-projects#150` now governs the required compound
approval bridge and immutable wrapper contract/artifact. RFC-0011 is blocked on
its acceptance and publication.

## Proposed contract

RFC-0011 proposes:

- `github.projects.item.status.set@1.0.0` for one fixed synthetic Effect B item;
- a single `mcp_pending` to `mcp_verified` status operation through immutable
  Yukh Projects v1.7.0 controlled apply;
- a compound admission with separate MCP and Projects assertions plus an
  accepted non-authorizing cross-binding bridge;
- an MCP provider boundary blocked on a future immutable Yukh Projects wrapper
  rather than direct composition of v1.7.0 primitives;
- independent authorization, materialization, Coordination, durable audit,
  verification, and evidence;
- durable `completion_unknown` with no automatic retry; and
- `github.projects.item.status.restore@1.0.0` as a separately planned and
  approved restore lifecycle.

## Context impact

This non-authoritative session record navigates the proposed RFC and its
governing records. It cannot accept RFC-0011 or authorize implementation.

The Project 5 / issue 27 profile remains governed by RFC-0007 through RFC-0009.
Its static single-token exception is not reused. The proposed suite sandbox
profile instead follows the OIDC-bound one-shot materialization decision in the
accepted suite RFC.

## Required next gate

Yukh Projects must first accept and immutably publish the bridge and wrapper
contract/artifact governed by issue #150. RFC-0011 must then pin those accepted
artifacts and receive explicit owner acceptance before a separate issue may
implement even an unreachable disabled registration skeleton. Deployment,
activation, credentials, network access, a live synthetic apply, restore, and
operational readiness each retain later independent gates.
