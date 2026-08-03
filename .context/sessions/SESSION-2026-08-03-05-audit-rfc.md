# Session — audit evidence RFC

- Date: 2026-08-03
- Governing issue: https://github.com/nomed/yukh-mcp/issues/9
- Branch: `agent/issue-9-audit-rfc`
- Status: RFC accepted by project owner; merge pending

## Outcome

Drafted RFC-0004 for a closed, versioned audit envelope; event registry;
request-to-outcome correlation and causation; structural redaction; protected
projections; per-stream atomic ordering and hash chaining; checkpoints; honest
integrity limitations; phase-aware sink failure; retention; holds; deletion
manifests; and bounded exports. Added the corresponding threat-model delta.

## Key decisions

- Raw prompts, credentials, identity claims, policy inputs, provider bodies,
  target content, stack traces, and arbitrary metadata are forbidden by schema.
- Hash chaining is described as integrity-verifiable, not immutable or
  tamper-proof; truncation and a compromised unwitnessed writer remain risks.
- Required evidence must commit durably before provider start. Failure after
  provider start cannot erase a possible effect, so success is withheld and a
  separately qualified recovery journal is required.
- RFC-0004 supplies the audit dependency of proposed RFC-0003 without creating a
  circular normative dependency.

## Boundary

No schema implementation, writer, store, journal, checkpoint key, resolver,
exporter, provider, credential, deployment, or production claim was introduced.
