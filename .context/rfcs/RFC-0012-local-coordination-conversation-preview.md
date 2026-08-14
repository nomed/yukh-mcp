# RFC-0012 — Local Coordination conversation preview

- Status: Accepted
- Authors: Codex
- Created: 2026-08-14
- Accepted: 2026-08-14
- Decider: project owner
- Governing issue: https://github.com/nomed/yukh-mcp/issues/109
- Depends on: RFC-0001, RFC-0002, RFC-0004

The project owner explicitly accepted this RFC on 2026-08-14. Acceptance
authorizes only the local preview implementation and qualification described
here; it grants no production, remote MCP or provider authority.

## Summary

Add a preview-only MCP STDIO server that lets two local agent hosts exchange
signed Yukh Coordination questions and answers. Codex and Copilot each start a
separate server process with a fixed Coordination profile; both profiles use
the same local coordinator and transcript.

The server exposes exactly five tools:

- `coordination.join`;
- `coordination.ask`;
- `coordination.answer`;
- `coordination.replay`;
- `coordination.leave`.

## Motivation

The Coordination local preview now proves two native clients, JetStream,
signed publication and replay. It does not prove that real MCP hosts discover
and use those operations. The first useful interoperability test must show a
Codex question reaching Copilot and a Copilot answer reaching Codex without
granting either host provider or protected-target authority.

## Goals

- use the existing Coordination 0.1 event and receipt contracts unchanged;
- support Codex and Copilot CLI/app through standard MCP STDIO;
- bind one immutable agent profile to each server process;
- keep credentials and root keys outside MCP inputs, results and logs;
- invoke only fixed native-client operations with canonical bounded JSON;
- return verified transcript records in bounded structured results;
- provide one Mac qualification and teardown procedure.

## Non-goals

- production use, remote MCP, OAuth or a public listener;
- generic command, shell, path, URL, header or credential input;
- provider execution, project mutation, approval or capability authority;
- background polling, autonomous replies or claims that two models share one
  context window;
- changing the ordinary inert gateway or RFC-0005 protected-lifecycle adapter.

## Detailed design

The preview server is a separate entrypoint and is never registered by the
ordinary gateway. Startup requires an exact absolute Coordination launcher and
one profile selected from `agent-a` or `agent-b`. Configuration is process
owned; no tool may select an agent, executable, working directory, endpoint,
credential, environment variable or command.

The adapter starts the launcher without a shell, passes only a fixed command
array and canonical JSON on standard input, enforces a five-second deadline,
and accepts at most 1 MiB of closed JSON output. The launcher owns root-key and
session-token handling. MCP never reads or serializes those values.

Tool mappings are fixed:

| MCP tool | Coordination command | Effect |
| --- | --- | --- |
| `coordination.join` | `session join` | append presence |
| `coordination.ask` | `question ask` | append question |
| `coordination.answer` | `question answer` | append answer |
| `coordination.replay` | `events replay` | verified read |
| `coordination.leave` | `session leave` | append departure |

Inputs mirror only the closed fields required by the existing CLI. Replay
results are capped to the configured transcript bounds. Upstream exit codes and
closed `YKC-*` codes are retained; stderr and arbitrary exception text are
discarded.

The server declares replay read-only. Join, ask, answer and leave are declared
non-destructive writes so each host can apply its own MCP approval policy.

## Trust boundaries and threat analysis

The new boundary is a model-selected MCP tool call to a fixed local
Coordination client. Principal threats are command or profile substitution,
credential disclosure, prompt-supplied executable paths, oversized results,
duplicate publication and treating transcript content as authority.

Controls are a closed tool registry, fixed process configuration, no shell,
no caller-selected commands or paths, strict schemas and byte limits, exact
timeouts, sanitized failures and signed-receipt verification by the native
client. Transcript messages remain untrusted coordination data and never grant
MCP capability or provider authority.

Residual preview risks are local process compromise, availability, model misuse
of valid write tools and disclosure of deliberately published transcript text.
The profile is therefore local, disposable and unsuitable for secrets.

## Compatibility

The ordinary gateway remains inert and existing discovery tests must continue
to return no tools. The new entrypoint consumes the qualified Coordination
preview as an external executable contract and does not import Coordination
source or schemas.

Codex supports local STDIO MCP through its shared MCP configuration. Copilot
CLI and the Copilot app support local STDIO servers. Copilot cloud agent is not
part of this preview because it cannot reach the Mac-local Coordination
runtime.

## Rollout and rollback

1. Accept this RFC.
2. Implement the isolated server and negative tests.
3. Add a hermetic MCP-client qualification using a fake fixed launcher.
4. Qualify Codex and Copilot against the live Mac preview.
5. Remove the preview entrypoint and configuration to roll back; no migration
   is required.

## Alternatives

### Ask agents to run CLI commands

Rejected as the acceptance target because it proves prompting and shell access,
not MCP discovery or typed tool use.

### Expose one shared HTTP MCP server

Deferred because caller identity and authorization would require a larger
deployment profile. Separate STDIO processes preserve explicit identities.

### Reimplement Coordination authentication in TypeScript

Rejected because it duplicates the qualified native client and its custody,
DPoP, TLS and receipt-verification boundaries.

## Open questions

None for the local preview.
