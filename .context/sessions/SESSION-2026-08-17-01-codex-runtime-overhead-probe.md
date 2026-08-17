# SESSION-2026-08-17-01 — Codex runtime overhead probe

- Governing issue: https://github.com/nomed/yukh-mcp/issues/220
- Scope: measure Codex runtime overhead before enabling Codex SDK workers

## Measurements

All probes used the same repository root and a minimal prompt:

> Reply exactly: OK. Do not inspect files. Do not run commands.

`codex exec --ephemeral --json --ignore-user-config --ignore-rules --sandbox read-only`
reported stable per-run cost:

| mode             | run |  input | cached input | output |  total |
| ---------------- | --: | -----: | -----------: | -----: | -----: |
| Codex CLI `exec` |   1 | 13,797 |        9,984 |      6 | 13,803 |
| Codex CLI `exec` |   2 | 13,797 |        9,984 |      5 | 13,802 |

The TypeScript Codex SDK was inspected and confirmed to wrap `codex exec`. A
same-thread two-turn probe therefore still launched `exec` for each turn and
used `resume` for the second turn:

| mode                       | turn |  input | cached input | output |  total |
| -------------------------- | ---: | -----: | -----------: | -----: | -----: |
| TypeScript SDK same thread |    1 |  9,216 |            0 |    516 |  9,732 |
| TypeScript SDK same thread |    2 | 18,459 |        9,088 |    552 | 19,011 |

The Python `openai-codex` SDK was installed in a temporary venv and measured
through one live `Codex` client. It reduced latency after the first turn but did
not eliminate per-turn token overhead:

| mode                       | turn/thread |  input | cached input | output |  total | duration |
| -------------------------- | ----------: | -----: | -----------: | -----: | -----: | -------: |
| Python SDK same thread     |           1 |  8,719 |            0 |    225 |  8,944 | 6,262 ms |
| Python SDK same thread     |           2 | 11,785 |        8,576 |     50 | 11,835 | 1,603 ms |
| Python SDK separate thread |           1 |  8,719 |            0 |     41 |  8,760 | 4,369 ms |
| Python SDK separate thread |           2 | 10,103 |        6,272 |     24 | 10,127 | 3,371 ms |

## Conclusion

The overhead is not only a first process cold start. Every Codex worker turn
still carries a substantial base context, even when a runtime/client is reused.
Python app-server reuse is promising for latency and may reduce the floor versus
plain `codex exec`, but the evidence is not sufficient to lower Yukh's current
Codex worker token floor because the accepted 120k floor came from a real Yukh
worker prompt, not this minimal probe.

## Next safe increment

Keep Codex as manager/root by default. Before enabling Codex SDK workers, build a
bounded runner qualification that uses the actual Yukh worker prompt and records
trusted `usage.last`/`usage.total` from Python app-server execution.
