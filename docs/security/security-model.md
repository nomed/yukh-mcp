# Security model

Yukh MCP is deny-by-default.

Authentication establishes an identity. It does not grant capability. Authorization evaluates subject, action, resource, environment, constraints, and current policy for every protected operation.

## Authentication and authorization

Authentication supplies a verified subject and authentication context. It does
not select a capability, establish resource ownership, satisfy an approval, or
grant provider authority.

For every protected operation, the gateway constructs an authorization request
from the authenticated subject, exact capability action, canonical resource,
environment, constraints, and current policy version. The server enforces the
decision before planning or provider invocation. A missing input, unknown
decision, timeout, unavailable dependency, invalid response, or policy-version
mismatch is a denial; callers cannot opt into fail-open behavior.

Authorization decisions and required approvals are distinct. An approval may
satisfy an obligation on one exact immutable plan, but cannot broaden the
underlying authorization decision or be replayed for another subject, action,
resource, environment, plan, policy version, or validity window.

## Credential isolation

Provider credentials are acquired, used, rotated, and revoked behind the
execution boundary. They are never accepted as capability input, returned as
capability output, written to plans or evidence, or exposed to model context.
Providers receive only the authority required for the selected operation and
target. Logs and errors use allowlisted structured fields and redact sensitive
values by construction.

## Core invariants

1. Models never receive infrastructure private keys.
2. Public capabilities do not accept unrestricted shell strings.
3. Every mutation has an inspectable plan.
4. Destructive operations require explicit approval.
5. Verification is distinct from execution.
6. Logs and errors redact credentials and sensitive values.
7. Policy failure, uncertainty, or dependency failure resolves to deny.
8. Audit evidence identifies the decision and result without retaining secrets.

These invariants apply independently of MCP client, identity provider, policy
engine, capability provider, target platform, or audit backend.

See the [threat model](threat-model.md) for initial trust boundaries and threats.
