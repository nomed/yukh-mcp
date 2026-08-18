const data = {
  workspace: "yukh-task-board",
  teams: [
    {
      id: "team-manager-preview",
      goal: "Improve the Yukh control plane with one bounded UI increment.",
      mode: "plan-first",
      state: "waiting for approval",
      budget: { allocated: 120000, reserved: 40000, used: 18420 },
      agents: [
        {
          name: "manager",
          role: "product-engineering manager",
          provider: "Codex CLI",
          state: "planned",
        },
        {
          name: "frontend-worker",
          role: "UI implementer",
          provider: "Copilot SDK",
          state: "proposed",
        },
        {
          name: "qa-worker",
          role: "runtime verifier",
          provider: "Codex SDK planned",
          state: "not launched",
        },
      ],
    },
    {
      id: "team-task-board-smoke",
      goal: "Verify automatic Coordination handoff.",
      mode: "delegate",
      state: "complete",
      budget: { allocated: 80000, reserved: 55000, used: 31200 },
      agents: [
        { name: "agent-b", role: "frontend worker", provider: "Copilot CLI", state: "answered" },
      ],
    },
  ],
  topology: [
    {
      name: "Projects governance",
      owner: "yukh-projects",
      state: "ready for handoff",
      writes: "YKP_WORK_EVENTS_V1 and rebuildable KV projections",
      rule: "Admits claims, leases, budgets, roadmap and result evidence.",
    },
    {
      name: "Orchestration",
      owner: "yukh-mcp / Control Plane",
      state: "preview",
      writes: "team state, action receipts and worker lifecycle",
      rule: "Consumes Projects handoffs and starts bounded managers or workers.",
    },
    {
      name: "Agent communication",
      owner: "yukh-coordination",
      state: "local preview",
      writes: "Coordination transcript and receipt store",
      rule: "Carries join, ask, answer and replay. A message is evidence, not work authority.",
    },
    {
      name: "JetStream runtime",
      owner: "NATS",
      state: "shared service",
      writes: "separate stream and bucket namespaces",
      rule: "May be one physical runtime, never one shared logical contract.",
    },
  ],
  transcript: [
    {
      time: "12:31:18",
      kind: "question",
      from: "agent:a",
      to: "agent:b",
      body: "Confirm that the coordinator launched you and report the question event id.",
      eventId: "01a00fb4-71a3-7b10-9b1f-0dc8f6d3fcd6",
    },
    {
      time: "12:32:02",
      kind: "answer",
      from: "agent:b",
      to: "agent:a",
      body: "Confirmed. The coordinator launched me through Yukh Coordination.",
      eventId: "01a00fb7-2a0e-7a21-a5f2-preview",
    },
    {
      time: "12:32:03",
      kind: "coordinator",
      from: "coordinator",
      to: "observer",
      body: "Answer verified. The worker response is linked to the original question and receipt.",
      eventId: "lifecycle:answer-verified",
    },
  ],
};

const byId = (id) => document.getElementById(id);
const topologyStateLabel = (state) => state.replaceAll("_", " ");
const loadTopology = async () => {
  try {
    const response = await fetch("./api/topology/status", { cache: "no-store" });
    if (!response.ok) return data.topology;
    const status = await response.json();
    if (
      status?.schema !== "yukh-control-plane-topology-status-v1" ||
      !Array.isArray(status.runtimes)
    ) {
      return data.topology;
    }
    return status.runtimes;
  } catch {
    return data.topology;
  }
};
const loadTeams = async () => {
  try {
    const response = await fetch("./api/teams/status", { cache: "no-store" });
    if (!response.ok) return data.teams;
    const status = await response.json();
    if (status?.schema !== "yukh-control-plane-team-status-v1" || !Array.isArray(status.teams)) {
      return data.teams;
    }
    return status.teams;
  } catch {
    return data.teams;
  }
};

const teams = await loadTeams();
const teamBudget = (team) => team.budget ?? team.tokens;
const teamId = (team) => team.id ?? team.team_id;
const teamGoal = (team) => team.goal ?? `goal ${team.goal_digest.slice(0, 19)}…`;
const teamMode = (team) => team.mode ?? team.manager_runtime ?? "manager runtime";
const agentName = (agent) => agent.name ?? `${agent.kind}:${agent.role}`;
const agentProvider = (agent) => agent.provider ?? agent.runtime;
const activeTeams = teams.filter((team) => !["complete", "stopped"].includes(team.state));
const agents = teams.flatMap((team) => team.agents);
const used = teams.reduce(
  (sum, team) => sum + (teamBudget(team)?.used ?? teamBudget(team)?.observed ?? 0),
  0,
);
const allocated = teams.reduce(
  (sum, team) => sum + (teamBudget(team)?.allocated ?? teamBudget(team)?.budget ?? 0),
  0,
);

byId("workspace-name").textContent = data.workspace;
byId("metric-teams").textContent = String(activeTeams.length);
byId("metric-agents").textContent = String(agents.length);
byId("metric-budget").textContent =
  allocated > 0 ? `${Math.round((used / allocated) * 100)}% used` : "no budget";
byId("metric-providers").textContent = "CLI + SDK";

const topology = await loadTopology();
byId("topology-panels").innerHTML = topology
  .map(
    (node) => `
      <article class="topology-node">
        <div class="section-title">
          <div>
            <p class="eyebrow">${node.owner}</p>
            <h4>${node.name}</h4>
          </div>
          <span class="status-pill small"><span class="dot ${node.state.includes("ready") ? "ok" : "warn"}"></span>${topologyStateLabel(node.state)}</span>
        </div>
        <dl>
          <div><dt>Writes</dt><dd>${node.writes}</dd></div>
          <div><dt>Rule</dt><dd>${node.rule}</dd></div>
        </dl>
      </article>
    `,
  )
  .join("");

byId("team-list").innerHTML = teams
  .map(
    (team) => `
      <article class="team-row">
        <div>
          <p class="eyebrow">${teamMode(team)}</p>
          <h3>${teamId(team)}</h3>
          <p class="muted">${teamGoal(team)}</p>
          <div class="agent-stack">
            ${team.agents
              .map(
                (agent) =>
                  `<span class="chip ${["answered", "completed"].includes(agent.state) ? "good" : ""}">${agentName(agent)}: ${agentProvider(agent)}</span>`,
              )
              .join("")}
          </div>
        </div>
        <span class="status-pill small"><span class="dot ${team.state === "complete" ? "ok" : "warn"}"></span>${team.state}</span>
      </article>
    `,
  )
  .join("");

byId("budget-panel").innerHTML = teams
  .map((team) => {
    const budget = teamBudget(team);
    const budgetTotal = budget?.allocated ?? budget?.budget ?? 0;
    const budgetUsed = budget?.used ?? budget?.observed ?? 0;
    const budgetReserved = budget?.reserved ?? budget?.allocated ?? 0;
    const percentage = budgetTotal > 0 ? Math.round((budgetUsed / budgetTotal) * 100) : 0;
    return `
      <article class="budget-row">
        <div class="section-title">
          <strong>${teamId(team)}</strong>
          <span class="muted">${budgetUsed.toLocaleString()} / ${budgetTotal.toLocaleString()}</span>
        </div>
        <div class="bar" aria-label="${percentage}% token budget used"><span style="width: ${percentage}%"></span></div>
        <span class="muted">Reserved: ${budgetReserved.toLocaleString()} tokens</span>
      </article>
    `;
  })
  .join("");

byId("transcript-list").innerHTML = data.transcript
  .map(
    (event) => `
      <article class="event-row ${event.kind}">
        <div class="event-meta">
          <span>${event.time}</span>
          <span>${event.from} → ${event.to}</span>
          <span>${event.kind}</span>
          <span>${event.eventId}</span>
        </div>
        <p>${event.body}</p>
      </article>
    `,
  )
  .join("");
