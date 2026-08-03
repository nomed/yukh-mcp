# Session — local read-only node provider

- Date: 2026-08-03
- Governing issue: https://github.com/nomed/yukh-mcp/issues/8
- Branch: `agent/issue-8-local-read-provider`
- Status: implementation complete locally; draft PR pending

## Outcome

Implemented the experimental network-free `node.inspect` provider boundary.
Configured node roots are canonicalized server-side. Requests reject traversal,
absolute paths, control characters, unknown nodes, unsupported entries, and all
symbolic links. Results contain bounded metadata, source, observation time, and
freshness without file contents or directory listings.

The invocation pipeline validates input before authorization, records zero
provider attempts on deny, validates and bounds provider output before release,
and returns capability-contract-shaped results with authorization evidence
references. The inert MCP listener remains unchanged and discovers no tools.

## Validation

- capability definition accepted by the v1 contract validator;
- TypeScript typecheck and build;
- 50 contract and supply-chain tests;
- 16 runtime tests including traversal, symlink, pre-authorization denial,
  malformed input, and malformed provider output;
- Prettier and `git diff --check`.

## Boundary

No MCP tool, authentication adapter, policy engine, Project mutation,
coordination authority, credential, production root, release, or publication is
introduced. OS-level containment and authenticated transport integration remain
future work.
