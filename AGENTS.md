# Agent instructions

## Mission

Build Yukh MCP as a secure, vendor-neutral capability gateway for policy-governed, auditable, and verifiable agent operations.

## Required reading

Before meaningful work, read:

1. `.context/manifest.yaml`;
2. `.context/README.md`;
3. this file and any nearer `AGENTS.md`;
4. accepted decisions and relevant RFCs;
5. `docs/security/threat-model.md`;
6. the governing GitHub Issue and latest applicable handoff.

## Non-negotiable security rules

- Deny by default.
- Never expose unrestricted shell execution as a public capability.
- Never commit secrets, credentials, private keys, tokens, sensitive infrastructure identifiers, personal data, or private reasoning.
- Authentication never implies authorization.
- Every protected operation declares subject, resource, action, environment, and policy decision.
- Every mutation supports plan and verification semantics.
- Destructive actions require explicit human approval and must not be silently retried.
- Logs and errors redact secrets by construction.
- Security-boundary changes require an RFC and threat-model update.

## Context discipline

- `.context/` is durable operating memory.
- Sessions and handoffs preserve evidence but cannot change architecture.
- Accepted ADRs and RFCs are immutable; supersede them with a new record.
- Every substantive PR references a governing Issue and declares context impact.
- Architecture and security changes without an accepted record are forbidden.

## Delivery

- Work through a GitHub Issue.
- Keep changes narrowly scoped.
- Add negative and failure-path tests with behavior changes.
- Treat documentation and examples as product interfaces.
- Record validation evidence in the PR.
