# Session — solo-owner administrative merge policy

- Date: 2026-08-03
- Governing issue: https://github.com/nomed/yukh-mcp/issues/1
- Branch: `agent/document-owner-admin-bypass`
- Status: documentation complete locally; pull request pending

## Outcome

Recorded the repository's actual `main` protection state and the intentional
solo-owner exception. Normal merges remain subject to review, current required
checks, conversation resolution, and linear history. Administrator enforcement
is disabled so the sole administrator, `nomed`, can explicitly select GitHub's
administrative merge path when approval separation is unavailable.

## Boundary and accountability

The administrative path is break-glass authority over repository governance,
not a selective review override: it can bypass every applicable branch
protection. Each use therefore requires explicit owner authorization for the
specific change and durable evidence of the reason, validation state, and
merged commit.

This exception grants no MCP runtime authority. It does not approve a plan,
expand a capability, authorize mutation, or change the default-deny execution
model.
