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
          kind: "manager",
          role: "product-engineering manager",
          provider: "Codex CLI",
          state: "planned",
          required_actions: ["team.status", "agent.engage", "agent.await"],
          missing_required_actions: ["agent.engage", "agent.await"],
        },
        {
          name: "frontend-worker",
          kind: "worker",
          role: "UI implementer",
          provider: "Copilot SDK",
          state: "proposed",
          required_actions: [],
          missing_required_actions: [],
        },
        {
          name: "qa-worker",
          kind: "worker",
          role: "runtime verifier",
          provider: "Codex SDK planned",
          state: "not launched",
          required_actions: [],
          missing_required_actions: [],
        },
      ],
      plans: [{ plan_id: "plan-preview", state: "proposed", worker_count: 2, has_synthesis: true }],
      receipts_count: 1,
      tasks: [
        {
          id: "YKP-CP-252",
          title: "Expose manager detail without leaking private task bodies",
          owner: "manager",
          state: "review",
          priority: "high",
        },
        {
          id: "YKP-CP-253",
          title: "Design command center overview for operators",
          owner: "frontend-worker",
          state: "in_progress",
          priority: "high",
        },
        {
          id: "YKP-CP-254",
          title: "Add provider/model configuration after read-only flow is understandable",
          owner: "delivery-manager",
          state: "ready",
          priority: "medium",
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
        {
          name: "agent-b",
          kind: "worker",
          role: "frontend worker",
          provider: "Copilot CLI",
          state: "answered",
          required_actions: [],
          missing_required_actions: [],
        },
      ],
      plans: [],
      receipts_count: 2,
      tasks: [
        {
          id: "YKP-SMOKE-001",
          title: "Verify coordinator launches a worker and validates the answer receipt",
          owner: "agent-b",
          state: "done",
          priority: "medium",
        },
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
const agentStateClass = (state) =>
  ["answered", "completed", "done"].includes(state) ? "ok" : "warn";
const teamManager = (team) =>
  team.agents.find((agent) => agent.kind === "manager") ?? team.agents[0];
const teamWorkers = (team) => team.agents.filter((agent) => agent !== teamManager(team));
const taskStateRank = { ready: 0, in_progress: 1, review: 2, done: 3 };
const teamTasks = (team) =>
  team.tasks ?? [
    ...(team.plans ?? []).map((plan) => ({
      id: plan.plan_id,
      title: `Plan ${plan.state} with ${plan.worker_count} proposed workers`,
      owner: teamManager(team)?.role ?? "manager",
      state: plan.state === "approved" ? "in_progress" : "ready",
      priority: "medium",
    })),
    ...teamWorkers(team).map((worker) => ({
      id: worker.agent_id,
      title: `${worker.role} worker lifecycle`,
      owner: agentName(worker),
      state: worker.state === "completed" || worker.state === "answered" ? "done" : "in_progress",
      priority: "medium",
    })),
  ];
const allTasks = teams
  .flatMap((team) => teamTasks(team).map((task) => ({ ...task, team_id: teamId(team) })))
  .sort((a, b) => (taskStateRank[a.state] ?? 9) - (taskStateRank[b.state] ?? 9));
const conversations = [
  ...data.transcript.map((event) => ({
    id: event.eventId,
    label: `${event.from} → ${event.to}`,
    state: event.kind,
    body: event.body,
  })),
  ...teams.flatMap((team) =>
    (team.agents ?? [])
      .filter((agent) => (agent.missing_required_actions ?? []).length > 0)
      .map((agent) => ({
        id: `${teamId(team)}:${agentName(agent)}:missing`,
        label: `${agentName(agent)} · required actions`,
        state: "missing",
        body: `Missing ${agent.missing_required_actions.join(", ")}`,
      })),
  ),
].slice(0, 5);
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

byId("manager-count").textContent = `${activeTeams.length} active`;
byId("manager-list").innerHTML = teams
  .map((team) => {
    const manager = teamManager(team);
    const workers = teamWorkers(team);
    const budget = teamBudget(team);
    const budgetTotal = budget?.allocated ?? budget?.budget ?? 0;
    const budgetUsed = budget?.used ?? budget?.observed ?? 0;
    const percentage = budgetTotal > 0 ? Math.round((budgetUsed / budgetTotal) * 100) : 0;
    const missing = manager?.missing_required_actions ?? [];
    return `
      <article class="manager-card">
        <div class="manager-card-main">
          <p class="eyebrow">${teamMode(team)}</p>
          <h4>${manager?.role ?? "manager pending"}</h4>
          <p class="muted clamp-2">${teamGoal(team)}</p>
        </div>
        <div class="manager-card-meta">
          <span class="status-pill small"><span class="dot ${team.state === "complete" ? "ok" : "warn"}"></span>${team.state}</span>
          <span>${workers.length} workers</span>
          <span>${percentage}% budget</span>
          <span>${missing.length === 0 ? "receipts ok" : `${missing.length} missing`}</span>
        </div>
      </article>
    `;
  })
  .join("");

byId("task-board").innerHTML = ["ready", "in_progress", "review", "done"]
  .map((state) => {
    const tasks = allTasks.filter((task) => task.state === state);
    return `
      <section class="task-column">
        <div class="task-column-title">
          <strong>${state.replaceAll("_", " ")}</strong>
          <span>${tasks.length}</span>
        </div>
        ${tasks
          .map(
            (task) => `
              <article class="task-card">
                <span class="chip">${task.id}</span>
                <h4>${task.title}</h4>
                <p class="muted">${task.team_id} · ${task.owner}</p>
                <span class="priority ${task.priority}">${task.priority}</span>
              </article>
            `,
          )
          .join("")}
      </section>
    `;
  })
  .join("");

byId("conversation-feed").innerHTML = conversations
  .map(
    (event) => `
      <article class="conversation-event">
        <div>
          <span class="chip">${event.state}</span>
          <strong>${event.label}</strong>
        </div>
        <p class="muted clamp-2">${event.body}</p>
      </article>
    `,
  )
  .join("");

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

const selectedTeam = activeTeams[0] ?? teams[0];
if (selectedTeam) {
  const manager = teamManager(selectedTeam);
  const workers = teamWorkers(selectedTeam);
  const plans = selectedTeam.plans ?? [];
  const missing = manager?.missing_required_actions ?? [];
  byId("manager-detail-panel").innerHTML = `
    <article class="manager-summary">
      <div>
        <p class="eyebrow">${teamMode(selectedTeam)}</p>
        <h3>${manager ? `${manager.role} · ${agentProvider(manager)}` : "No manager registered"}</h3>
        <p class="muted">${teamGoal(selectedTeam)}</p>
      </div>
      <span class="status-pill small"><span class="dot ${selectedTeam.state === "complete" ? "ok" : "warn"}"></span>${selectedTeam.state}</span>
    </article>
    <div class="manager-grid">
      <article>
        <span>Required receipts</span>
        <strong>${manager?.required_actions?.length ?? 0}</strong>
        <p class="muted">${missing.length === 0 ? "none missing" : `missing: ${missing.join(", ")}`}</p>
      </article>
      <article>
        <span>Workers</span>
        <strong>${workers.length}</strong>
        <p class="muted">${workers.map((worker) => `${worker.role}: ${worker.state}`).join(" · ") || "none"}</p>
      </article>
      <article>
        <span>Plans</span>
        <strong>${plans.length}</strong>
        <p class="muted">${plans.map((plan) => `${plan.state}, workers=${plan.worker_count}`).join(" · ") || "no plan"}</p>
      </article>
    </div>
    <div class="worker-table">
      ${[manager, ...workers]
        .filter(Boolean)
        .map(
          (agent) => `
            <article>
              <div>
                <strong>${agent.role}</strong>
                <span class="muted">${agentName(agent)} · ${agentProvider(agent)} · ${agent.coordination_participant ?? "coordination pending"}</span>
              </div>
              <span class="status-pill small"><span class="dot ${agentStateClass(agent.state)}"></span>${agent.state}</span>
            </article>
          `,
        )
        .join("")}
    </div>
  `;
} else {
  byId("manager-detail-panel").innerHTML =
    '<p class="muted">No team state yet. Start from a manager plan to populate this view.</p>';
}

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
