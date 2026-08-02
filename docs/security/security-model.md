# Security model

Yukh MCP is deny-by-default.

Authentication establishes an identity. It does not grant capability. Authorization evaluates subject, action, resource, environment, constraints, and current policy for every protected operation.

## Core invariants

1. Models never receive infrastructure private keys.
2. Public capabilities do not accept unrestricted shell strings.
3. Every mutation has an inspectable plan.
4. Destructive operations require explicit approval.
5. Verification is distinct from execution.
6. Logs and errors redact credentials and sensitive values.
7. Policy failure, uncertainty, or dependency failure resolves to deny.
8. Audit evidence identifies the decision and result without retaining secrets.

See the [threat model](threat-model.md) for initial trust boundaries and threats.
