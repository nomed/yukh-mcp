# Session - Effect B capability contract gate

- Date: 2026-08-09
- Governing issue: https://github.com/nomed/yukh-mcp/issues/96
- Suite issue: https://github.com/nomed/nomed.github.io/issues/40
- Suite RFC:
  `nomed/nomed.github.io@b23f47f2c90ec6b106eb4c9c746f6d1958e0c182`
- Status: Proposed component RFC awaiting owner acceptance

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

## Proposed contract

RFC-0011 proposes:

- `github.projects.item.status.set@1.0.0` for one fixed synthetic Effect B item;
- a single `mcp_pending` to `mcp_verified` status operation through immutable
  Yukh Projects v1.7.0 controlled apply;
- independent Effect B plan, authorization, approval, materialization,
  Coordination, durable audit, provider, verification, and evidence;
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

The project owner must explicitly accept RFC-0011 and its threat-model delta
before a separate issue may implement even an unreachable disabled registration
skeleton. Deployment, activation, credentials, network access, a live synthetic
apply, restore, and operational readiness each retain later independent gates.
