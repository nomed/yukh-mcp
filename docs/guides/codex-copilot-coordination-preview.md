# Connect Codex and Copilot locally

This preview uses the Yukh Coordination Compose sandbox already running on the
Mac. Each agent bootstraps its own short-lived session through MCP.

Build Yukh MCP from its repository:

```sh
npm ci --ignore-scripts
npm run build
```

Before starting a team, check the local suite checkout without installing
dependencies or starting services:

```sh
yukh suite baseline --workspace /path/to/yukh-workspace
```

The command reports the tracked Git state, runtime hints and documented
validation command for `nomed.github.io`, `yukh-mcp`, `yukh-projects` and
`yukh-coordination`. Detached checkouts are warnings; missing repositories or
tracked-file drift are errors.

Operator note: a warning means inspect the checkout before development; an
error means stop and fix the checkout before continuing.

This command is the gate before starting a Yukh-managed implementation worker.

For a small documentation change, start with the `micro-doc-edit` preset instead
of the generic implementation profile:

```sh
yukh team propose --preset micro-doc-edit --goal "Edit one named doc file for issue #..."
```

It budgets one non-delegating Codex worker at 35,000 tokens, `tool_mode: none`,
one command and a 120-second runtime. Use it only when the target file and issue
are already known; otherwise run a read-only verifier first.

Before approving the generated run command, check four lines in the proposal:
`token budget`, `max commands`, `provider launched` and `Approval digest`. If
the worker is broader than the issue, if `provider launched` is `yes`, or if the
budget is not appropriate for the edit, stop and create a narrower proposal.

For a small code fix, use `micro-code-edit` only after naming the files and the
single validation command:

```sh
yukh team propose --preset micro-code-edit --goal "Edit path/to/file.ts for issue #... and run node --test path/to/test.ts"
```

It budgets one non-delegating Codex worker at 45,000 tokens, one command and a
180-second runtime. If the fix needs broader discovery, multiple test commands
or dependency installation, do not use the micro preset; create an explicit
implementation proposal instead.

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
enabled_tools = ["manager.start", "team.status", "plan.status", "plan.execute", "agent.status", "team.stop"]
default_tools_approval_mode = "writes"
```

At startup, `yukh-team-control` discovers callable model IDs from the configured
agent CLIs. Codex uses `codex debug models`; Copilot currently exposes its local
catalog through `copilot help config`. Set model environment variables only to
override or narrow that discovered list. Skills remain explicit local policy:

```toml
env = { YUKH_CODEX_MODELS = "default,approved-codex-model", YUKH_COPILOT_MODELS = "default,approved-copilot-model", YUKH_CODEX_SKILLS = "api-design,testing,review", YUKH_COPILOT_SKILLS = "frontend,testing,product" }
```

Codex workers use the CLI runner by default. For tool-free Codex workers, opt
into the lower-overhead Python app-server provider only after installing
`openai-codex` for the selected Python:

```toml
env = { YUKH_CODEX_WORKER_PROVIDER = "python-app-server", YUKH_CODEX_PYTHON_EXECUTABLE = "/absolute/path/to/python3" }
```

This provider is used only when the worker runs with `tool_mode: none`; workers
that need Coordination or team-control tools stay on the CLI path. The preflight
token floor remains 120k for the CLI and becomes 18k for the opt-in Python
app-server path.

Start work with `manager.start`, not `team.create`. It creates the team and a
depth-zero manager runtime together, reserves the manager budget and returns a
server receipt plus the manager agent ID. Use `agent.await` from the controlling
session to retrieve its terminal completion. For efficient automatic work, set
`output_contract` to `team-plan-v1`: the manager returns one structured proposal
without tools. Read its plan ID and digest from status, then call `plan.execute`
with that exact digest. Model values outside the discovered or overridden model
set fail before process launch; skill values outside the explicit skill
allowlists fail the same way. The
worker must bootstrap and join Coordination before its agent CLI starts. Set
explicit token, command and runtime bounds: `team_token_budget`,
`manager_token_budget`, `max_commands` and `runtime_timeout_ms`. Every planned
agent must also declare `token_budget`, `max_commands`, `timeout_ms` and
`tool_mode`; use `none` unless Coordination or delegation is necessary.
Allocations are validated before launch. Older preview teams remain readable,
but an external unaccounted session cannot engage workers; recreate them with
`manager.start`.

`plan.execute` reserves every worker plus one synthesizer, starts and awaits the
workers without another manager model turn, then gives their bounded completion
artifacts to the separately budgeted tool-free synthesizer. Repeating the same
plan does not duplicate workers. The viewer shows plan state, observed/team
budget, accounting source and completion outcome. Codex currently supplies
trustworthy token counts. Copilot exposes credits and duration but not tokens, so a
token-strict Copilot worker terminates with `token_accounting_unavailable`
rather than inventing a conversion.
The CLI command `yukh team run-plan-approved` executes an already proposed plan
by team ID, plan ID and approved digest. A zero-command CLI proof on the VPS
completed one worker plus synthesis with 28,440 observed tokens: 120 manager,
14,092 worker and 14,228 synthesis.

From the workspace configured for the existing team, run the approved plan with
the identifiers returned by the proposal:

```sh
yukh team run-plan-approved \
  --team team-... \
  --plan plan-... \
  --approved-digest sha-256:... \
  --format text
```

Use the exact digest that the operator approved; the command fails closed if it
does not match the stored plan. The default cost boundary accepts only workers
and synthesis with `tool_mode: none` and `max_commands: 0`; unsafe dynamic
workers require explicit isolated qualification.

Issue #155 proved that a single provider turn can exceed its allocation before
usage is reported. Deterministic plans therefore run by default only when every
worker and the synthesizer use `tool_mode: none` and `max_commands: 0`; they
receive only the closed server-built prompt and cannot feed shell output into a
follow-up inference. Other dynamic execution returns
`dynamic_worker_cost_boundary_unavailable`. The escape hatch
`YUKH_ENABLE_UNSAFE_DYNAMIC_WORKERS=1` is for isolated qualification only.

For Copilot, use the equivalent MCP server values in `copilot mcp add`. Then ask
the manager:

```text
Use yukh-team-control. Call manager.start with a 120000-token team budget and a
20000-token Codex planning-manager budget, max_commands 2, runtime_timeout_ms
120000, no required actions and
output_contract team-plan-v1. Ask for the minimum specialists needed, explicit
token and timeout bounds, `tool_mode: none` and `max_commands: 0` for every
worker and synthesis. Show me the proposed plan and digest. After I approve that
exact digest, call plan.execute once and report terminal state and exact usage.
Do not use team.create and do not engage a runtime that cannot provide token
accounting.
```

Each zero-command worker may name at most four `context_paths`. At reservation,
the server accepts only repository-relative regular UTF-8 files, rejects links
and traversal, caps each file at 4 KiB and the pack at 12 KiB, then persists its
SHA-256 digest. The worker receives this pack in its prompt and cannot request
more context.

The tool-free planning profile measured 14,382 total tokens: 13,735 input,
including 9,984 cached, and 647 output. The 20,000-token allocation provides a
bounded margin; it is not a universal estimate. A one-command suite readonly
probe on the VPS measured 82,240 total tokens, mostly fixed Codex input context,
so the official readonly verifier allocation is 90,000 tokens and one command.
A tiny documentation implementation worker previously measured 90,893 total
tokens when it received unnecessary model-facing Yukh MCP tools.
After removing unnecessary model-facing Yukh MCP tools from simple
non-delegating implementation workers, a minimal no-edit Codex probe measured
14,003 total tokens and a real one-file documentation edit measured 60,965 total
tokens. The default implementation allocation is therefore 80,000 tokens and
the generic team preflight default is 260,000 tokens. Delegating workers still
receive the explicit Yukh tools they need for receipt-backed actions.
Keep simple workers non-delegating unless they need child agents or receipt-backed actions.
Compact implementation probes should use one small tracked file and one
explicit validation command. A compact preflight-to-worker documentation edit
measured 59,006 total worker tokens against the 80,000-token implementation
allocation.
A zero-command worker using two small context files measured 15,652 total tokens
against an 8,000-token allocation and failed closed after preserving its summary
for review. Use at least an 18,000-token worker budget for similar
review/planning workers. A tool-free synthesis measured 13,932 total tokens
against a 10,000-token allocation and failed closed after preserving its summary,
so use at least a 16,000-token synthesis budget for the same runtime class
unless fresh qualification evidence justifies less. Every operational tool call
is a separate context round and needs its own justified budget. Deterministic
plan execution adds no manager context rounds; only useful workers and the
explicit final synthesis consume additional model tokens. If a worker returns
useful text but exceeds budget, the plan fails before synthesis; inspect the
worker summary as a review artifact and approve a fresh plan rather than
retrying blindly.

The local preview script allows 32 generated agent identities per runtime
directory. Repeated dynamic-team tests can exhaust that preview limit and fail
with `agent limit reached` or bootstrap errors. Reset only the disposable local
preview runtime before continuing those tests.

Codex managers run without inherited user configuration. Yukh injects only the
tools required by the manager record; a pure planning turn receives no
model-facing MCP at all. A status-only operational turn receives only compact
team status and no Coordination tools. Its status result is a compact projection,
while the operator and conversation viewer retain full persistent state.

`agent.spawn` starts a real detached CLI and returns its PID and log path. A
worker with `can_spawn=true` receives the same team-control MCP but can create
only bounded children inside its team. It cannot create another root team,
cross team boundaries or stop the team.

Use `yukh conversation watch --full` to observe verified messages. Follow the
returned agent log when command-level detail is needed. For local team runtime
state, use `yukh team status --team team-...` and
`yukh team stop --team team-...`. The MCP tools `team.status` and `team.stop`
remain available to authorized manager sessions; the CLI commands are the
operator path when no manager server is running.

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

When the workspace contains a Yukh team, the same watcher also shows the
operator timeline. Read `TEAM` first for the shared budget and number of
agents, then each `TIMELINE` row for the current manager or worker state:
`status=working` means active, `status=waiting:...` names the missing receipt or
launch step, and terminal statuses such as `succeeded`, `agent_exit_nonzero` or
`token_budget_exceeded` explain why the worker stopped. Token lines report
observed usage against the assigned budget; `unaccounted=0` is the healthy
state. `COORDINATOR` lines are local wake-up events, not model messages.

The temporary local qualification profile starts Copilot with `--allow-all`, so
it can use every tool, path and URL required to complete the exercise. Start it
only on a trusted machine with a trusted transcript; this is not a production
security profile. Coordination carries messages and handoffs while local tools
perform the actual work.

Remove the Copilot server with `copilot mcp remove yukh-coordination`; remove
the Codex table and restart Codex. Stop the sandbox with the Coordination
`yukh-local-preview-macos.sh down` command.
