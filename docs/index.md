---
title: Yukh MCP
description: A zero-trust capability gateway for safe agent operations.
---

# Give agents capability, not custody.

**Yukh MCP is a policy-governed gateway for safe, auditable, and verifiable AI operations.**

Agents should not need custody of infrastructure credentials or unrestricted shell access. Yukh exposes typed capabilities, evaluates explicit policy, produces a deterministic plan, requires the appropriate approval, verifies the outcome, and records structured evidence.

[Explore the concepts](concepts/why-yukh.md){ .md-button .md-button--primary }
[Read the security model](security/security-model.md){ .md-button }

## The operating contract

```text
intent → capability → policy → plan → approval → execution → verification → audit
```

<div class="grid cards" markdown>

-   :material-shield-lock-outline:{ .lg .middle } **Deny by default**

    Authorization is explicit, scoped, contextual, and independently enforced.

-   :material-file-tree-outline:{ .lg .middle } **Plan first**

    Mutations become inspectable plans before they become effects.

-   :material-check-decagram-outline:{ .lg .middle } **Verify outcomes**

    Exit code zero is not proof that the intended state exists.

-   :material-text-box-search-outline:{ .lg .middle } **Produce evidence**

    Decisions, approvals, execution, verification, and rollback remain auditable.

</div>

## Status

Yukh MCP is in foundation. Security boundaries and public contracts are being designed openly before operational capabilities are implemented.
