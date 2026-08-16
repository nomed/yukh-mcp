# Connect Codex and Copilot locally

This preview uses the Yukh Coordination Compose sandbox already running on the
Mac. Each agent bootstraps its own short-lived session through MCP.

Build Yukh MCP from its repository:

```sh
npm ci --ignore-scripts
npm run build
```

Use absolute paths below. Configure Codex as `agent-a`:

```toml
[mcp_servers.yukh_coordination]
command = "node"
args = ["/path/to/yukh-mcp/dist/apps/coordination-preview/src/main.js"]
env = { YUKH_COORDINATION_AGENT = "agent-a", YUKH_COORDINATION_LAUNCHER = "/path/to/yukh-coordination/.github/scripts/yukh-local-agent.py" }
enabled_tools = ["coordination.bootstrap", "coordination.join", "coordination.ask", "coordination.answer", "coordination.replay", "coordination.leave"]
default_tools_approval_mode = "writes"
```

Restart Codex. Configure Copilot as `agent-b`:

```sh
copilot mcp add yukh-coordination \
  --env YUKH_COORDINATION_AGENT=agent-b \
  --env YUKH_COORDINATION_LAUNCHER=/path/to/yukh-coordination/.github/scripts/yukh-local-agent.py \
  --tools '*' -- node /path/to/yukh-mcp/dist/apps/coordination-preview/src/main.js
```

Ask Codex:

```text
Use yukh_coordination. Bootstrap, join, then ask Copilot on
https://preview.local/work/codex-copilot-first-contact:
"Reply with the Coordination event id you received and confirm this came through Yukh."
```

Ask Copilot:

```text
Use yukh-coordination. Bootstrap, join, replay the transcript, and answer the newest
question addressed to you. Preserve its work URI, correlation id and question
event id.
```

Finally ask Codex to replay the transcript and report the verified answer.

## Create a team from Codex or Copilot

Add `yukh-team-control` to the manager session. Its environment uses absolute
paths to the project workspace, Coordination launcher and both agent CLIs:

```toml
[mcp_servers.yukh_team_control]
command = "node"
args = ["/path/to/yukh-mcp/dist/apps/team-control/src/main.js"]
env = { YUKH_TEAM_WORKSPACE = "/path/to/project", YUKH_COORDINATION_LAUNCHER = "/path/to/yukh-local-agent.py", YUKH_CODEX_EXECUTABLE = "/absolute/path/to/codex", YUKH_COPILOT_EXECUTABLE = "/absolute/path/to/copilot" }
enabled_tools = ["team.create", "team.status", "agent.engage", "agent.await", "agent.status", "task.assign", "team.stop"]
default_tools_approval_mode = "writes"
```

Add comma-separated local allowlists when using composed profiles:

```toml
env = { YUKH_CODEX_MODELS = "default,approved-codex-model", YUKH_COPILOT_MODELS = "default,approved-copilot-model", YUKH_CODEX_SKILLS = "api-design,testing,review", YUKH_COPILOT_SKILLS = "frontend,testing,product" }
```

The manager uses `agent.engage` to compose any bounded professional role. Model
and skill values outside these allowlists fail before process launch. The
worker must bootstrap and join Coordination before its agent CLI starts. Set an
explicit team `token_budget` in `team.create` and a smaller `token_budget` for
every `agent.engage`. Allocations above the team budget are rejected.
Teams created by an older preview remain readable with budget zero but cannot
engage more workers; stop and recreate them with an explicit budget.

After engaging a child, use the returned `coordination_participant` exactly and
call `agent.await`. A successful terminal record contains the child's bounded
completion summary and structured usage. The viewer shows observed/team budget,
accounting source and completion outcome. Codex currently supplies trustworthy
token counts. Copilot exposes credits and duration but not tokens, so a
token-strict Copilot worker terminates with `token_accounting_unavailable`
rather than inventing a conversion.

For Copilot, use the equivalent MCP server values in `copilot mcp add`. Then ask
the manager:

```text
Use yukh-team-control. Create a 120000-token team for this workspace. Engage one
Codex backend developer with a 50000-token budget. Wait for its completion,
inspect its summary and usage, then report the result. Do not engage a runtime
that cannot provide token accounting.
```

`agent.spawn` starts a real detached CLI and returns its PID and log path. A
worker with `can_spawn=true` receives the same team-control MCP but can create
only bounded children inside its team. It cannot create another root team,
cross team boundaries or stop the team.

Use `yukh conversation watch --full` to observe verified messages. Follow the
returned agent log when command-level detail is needed. `team.status` shows the
persistent team and worker states. `team.stop` marks the team stopped; each
worker wrapper observes that state and terminates its own agent CLI.

## Run bounded automatic wake-up

After building this repository, start the local coordinator from the trusted
application workspace:

```sh
YUKH_COORDINATION_LAUNCHER=/absolute/path/to/yukh-local-agent.py \
YUKH_CODEX_EXECUTABLE=/absolute/path/to/codex \
YUKH_COPILOT_EXECUTABLE=/absolute/path/to/copilot \
YUKH_CONVERSATION_WORKSPACE=/absolute/path/to/task-board \
node /absolute/path/to/yukh-mcp/dist/apps/conversation-coordinator/src/main.js
```

Seed one directed question through `coordination.ask`. The coordinator wakes
the addressed CLI, which answers and may publish one directed follow-up. It
stops after 20 turns or four hours. Stop it earlier with `Ctrl+C`.

In a second terminal, follow the conversation and coordinator state:

```sh
cd /absolute/path/to/yukh-mcp
npm link
YUKH_COORDINATION_LAUNCHER=/absolute/path/to/yukh-local-agent.py \
YUKH_CONVERSATION_WORKSPACE=/absolute/path/to/task-board \
yukh conversation watch
```

The default view keeps long messages compact and hides repeated joins. Add
`--full` to inspect complete message bodies or `--verbose` when event and receipt
identifiers are needed. Answers show the question they belong to.

The temporary local qualification profile starts Copilot with `--allow-all`, so
it can use every tool, path and URL required to complete the exercise. Start it
only on a trusted machine with a trusted transcript; this is not a production
security profile. Coordination carries messages and handoffs while local tools
perform the actual work.

Remove the Copilot server with `copilot mcp remove yukh-coordination`; remove
the Codex table and restart Codex. Stop the sandbox with the Coordination
`yukh-local-preview-macos.sh down` command.
