# ADR-0001 — Repository-owned context system

- Status: Accepted
- Date: 2026-08-02
- Decider: project owner
- Governing issue: Foundation initiative

## Context

Yukh MCP will be developed publicly by humans and multiple agents across tools and sessions. Chat history and tool-local memory are not durable or portable enough to govern security, architecture, scope, and delivery.

## Decision

Yukh MCP maintains durable operating memory under `.context/`. Accepted ADRs and RFCs are authoritative. Sessions and handoffs preserve continuity and evidence but cannot change architecture. Material acceptance remains a human decision.

## Consequences

The repository remains portable and auditable. Contributors incur a small context-maintenance cost. Accepted records are superseded rather than rewritten.

## Security

The context directory is public. Secrets, credentials, sensitive infrastructure data, personal data, and private reasoning are forbidden.
