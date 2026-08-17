# SESSION-2026-08-17-02 — Codex Python worker prompt qualification

- Governing issue: https://github.com/nomed/yukh-mcp/issues/222
- Scope: repeatable qualification for Codex Python app-server with the Yukh worker prompt

## Implemented qualification

`.github/scripts/qualify-codex-python-app-server-worker.sh` builds a real Yukh
micro-worker prompt with `buildWorkerPrompt` and runs it through the Python
`openai-codex` app-server client. It is inert by default and requires:

```bash
YUKH_RUN_CODEX_PYTHON_APP_SERVER_QUALIFICATION=1
```

The default qualification sends no repository file content to the provider.
Context files are optional via `YUKH_CODEX_QUALIFICATION_CONTEXT_PATHS` and are
bounded to at most four repository-relative files of at most 4 KiB each, with no
absolute paths, traversal, `.git` or `.yukh`.

## Observed safe no-context run

Prompt bytes: 630.

| thread |  input | cached input | output | reasoning |  total | duration |
| ------ | -----: | -----------: | -----: | --------: | -----: | -------: |
| 1      |  8,848 |        8,704 |    710 |       610 |  9,558 | 5,325 ms |
| 2      | 10,232 |       10,112 |    598 |       481 | 10,830 | 5,340 ms |

Maximum observed total: 10,830 tokens.

## Decision impact

This qualifies the measurement path, not a Codex worker runner. The current
Codex CLI worker floor remains 120,000 tokens until a runner-level
qualification uses the same execution path that Yukh would actually launch for
workers.
