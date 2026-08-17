# SESSION-2026-08-17-03 — Codex Python worker provider

- Governing issue: https://github.com/nomed/yukh-mcp/issues/224
- Scope: opt-in Codex Python app-server provider for real `team-worker`

## Implemented

`YUKH_CODEX_WORKER_PROVIDER=python-app-server` now routes Codex workers through
the Python `openai-codex` app-server path when the worker is tool-free
(`tool_mode: none`). The default Codex provider remains the CLI runner.

The provider:

- starts a Codex Python app-server client per worker wrapper;
- uses read-only sandbox and deny-all approvals;
- disables web search;
- records token usage as `codex-python-app-server-v1`;
- fails closed through the existing `token_accounting_unavailable` path when
  usage is absent.

`YUKH_CODEX_PYTHON_EXECUTABLE` can select the Python interpreter. The env opt-in
is propagated through team-control, approved preflight and approved plan
execution.

## Token floor

The CLI floor stays at 120,000 tokens. With the Python app-server provider
enabled, tool-free Codex workers use an 18,000 token floor based on the #222
real-prompt qualification, which observed 10,830 total tokens in the safe
no-context run.

## Live runner probe

A real provider smoke test with `gpt-5.6-terra` completed through
`runCodexPythonWorker` with no repository context:

- input tokens: 10,652
- cached input tokens: 3,840
- output tokens: 15
- total tokens: 10,667
- budget outcome: within an 18,000 token worker budget

## Remaining constraint

This does not yet multiplex multiple Yukh workers through one long-lived Codex
Python client. It removes the CLI `exec` path for eligible tool-free workers,
but each worker wrapper still owns its runtime lifecycle.
