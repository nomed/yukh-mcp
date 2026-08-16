# RFC-0025 — Zero-command bounded-context workers

- Status: Accepted
- Date: 2026-08-16
- Decider: project owner
- Governing issue: https://github.com/nomed/yukh-mcp/issues/155
- Depends on: RFC-0020, RFC-0022 and RFC-0024

## Evidence

A worker allocated 12,000 tokens used 61,740 tokens after one read-only command.
The command returned a large result that entered a follow-up inference before
post-turn accounting could reject the overrun. Command count and elapsed time do
not enforce a token allocation within a provider turn.

## Decision

Default deterministic execution admits only agents with no model-facing MCP and
a zero-command limit. Each worker may receive a server-prepared context pack of
at most four repository-relative regular UTF-8 files, 4 KiB per file and 12 KiB
in aggregate. Absolute paths, traversal, links, `.git` and `.yukh` are rejected.
The pack is persisted with paths, byte length and SHA-256 digest and verified
again before prompt construction. Synthesis receives no file context.

Direct dynamic spawning remains disabled. The explicit unsafe execution flag is
restricted to isolated qualification and provides no cost guarantee.

## Consequence

This profile supports bounded analysis and design from selected code. Autonomous
editing remains blocked until a separately governed capability can apply a
closed patch without reopening unbounded model shell context.
