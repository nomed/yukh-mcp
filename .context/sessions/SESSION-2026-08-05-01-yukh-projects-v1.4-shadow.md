# Session — Yukh Projects v1.4 shadow qualification

- Date: 2026-08-05
- Governing issue: https://github.com/nomed/yukh-mcp/issues/27
- Branch: `agent/issue-27-v1.4-shadow`
- Status: shadow-only update prepared for review

## Outcome

The manual one-issue shadow workflow now pins immutable Yukh Projects v1.4.0
at `d1f787ca82c085b215146949d039aa217b399c27`. The repository policy routes
`kind` to native Issue Type. For this organization-owned repository, the
owner-aware provider must not propose a redundant Project `Work Type` field.

The workflow remains manually dispatched, read-only, bounded to one issue, and
structurally exposes no apply input or write credential. The legacy workflows
remain unchanged as the rollback surface.

## Required evidence

A fresh issue #27 shadow must demonstrate zero GraphQL requests, no retry, no
schema creation for `Work Type`, preservation of Project-owned `Status` and
`Component`, and a redacted exact operation summary. Any remaining drift must
be reviewed separately before controlled apply.

## Context impact

No MCP capability, provider, authentication, authorization, deployment, or
mutation boundary changes. The accepted read-only migration boundary remains
unchanged, so no RFC or threat-model delta is required.

## Exclusions

No Project mutation, live apply, legacy removal, deployment, field removal,
backfill, or completion of the consumer migration is authorized.
