# Session — Yukh Projects v1.5.1 planning parity

- Date: 2026-08-05
- Governing issue: https://github.com/nomed/yukh-mcp/issues/27
- Producer fix: https://github.com/nomed/yukh-projects/issues/121
- Status: read-only qualification prepared

## Outcome

The manual one-issue shadow workflow pins immutable Yukh Projects v1.5.1 at
`d58837397bc5856923e0e742458be34d8e5a27d6`. This release makes single-issue
legacy shadow use the exact owner-aware controlled planner. For this user-owned
repository, `kind` must route to the Project `Work Type` fallback.

## Required evidence

The issue #27 run must return the same plan ID and operation count as a fresh
controlled read, use zero GraphQL requests, preserve `Component` and
Project-owned `Status`, and perform no mutation.

## Context impact

This is an immutable dependency-pin correction inside the accepted read-only
migration boundary. It adds no capability, credential, deployment or mutation
authority; no RFC or threat-model change is required.
