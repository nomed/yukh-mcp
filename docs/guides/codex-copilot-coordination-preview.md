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

The coordinator lets Copilot read and write files only inside the selected
workspace and use the fixed `yukh-coordination` server. It does not grant shell
or network access; dependency installation and test execution remain operator
steps.

Remove the Copilot server with `copilot mcp remove yukh-coordination`; remove
the Codex table and restart Codex. Stop the sandbox with the Coordination
`yukh-local-preview-macos.sh down` command.
