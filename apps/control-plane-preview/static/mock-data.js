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
const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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
const tokenBudget = (agent) => agent.token_budget ?? 0;
const observedTokens = (agent) => agent.observed_tokens ?? 0;
const tokenPercent = (agent) =>
  tokenBudget(agent) > 0
    ? Math.min(100, Math.round((observedTokens(agent) / tokenBudget(agent)) * 100))
    : 0;
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
let selectedTeamId = teamId(activeTeams[0] ?? teams[0] ?? { id: "" });
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
      <article class="manager-card selectable" data-team-id="${teamId(team)}" role="button" tabindex="0" aria-controls="team-detail-panel">
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
              <article class="task-card selectable" data-team-id="${task.team_id}" role="button" tabindex="0" aria-controls="team-detail-panel">
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
      <article class="team-row selectable" data-team-id="${teamId(team)}" role="button" tabindex="0" aria-controls="team-detail-panel">
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

const setSelectedMarkers = () => {
  document.querySelectorAll("[data-team-id]").forEach((element) => {
    const active = element.getAttribute("data-team-id") === selectedTeamId;
    element.classList.toggle("selected", active);
    element.setAttribute("aria-current", active ? "true" : "false");
  });
};

const timelineForTeam = (team, plans, tasks, missing) => [
  {
    label: "team created",
    detail: `${teamMode(team)} · ${team.state}`,
    state: "done",
  },
  ...plans.map((plan) => ({
    label: `plan ${plan.state}`,
    detail: `${plan.worker_count} workers · synthesis ${plan.has_synthesis ? "present" : "missing"}`,
    state: plan.state,
  })),
  ...tasks.slice(0, 4).map((task) => ({
    label: task.title,
    detail: `${task.state} · owner ${task.owner}`,
    state: task.state,
  })),
  {
    label: missing.length === 0 ? "required actions satisfied" : "required action pending",
    detail: missing.length === 0 ? "manager receipts complete" : missing.join(", "),
    state: missing.length === 0 ? "done" : "waiting",
  },
];

const renderTeamDetail = (id) => {
  const selectedTeam = teams.find((team) => teamId(team) === id) ?? activeTeams[0] ?? teams[0];
  selectedTeamId = selectedTeam ? teamId(selectedTeam) : "";
  setSelectedMarkers();

  if (!selectedTeam) {
    byId("manager-detail-panel").innerHTML =
      '<p class="muted">No team state yet. Start from a manager plan to populate this view.</p>';
    byId("team-detail-panel").innerHTML =
      '<p class="muted">No team selected yet. Start from a manager plan to populate this view.</p>';
    return;
  }

  const manager = teamManager(selectedTeam);
  const workers = teamWorkers(selectedTeam);
  const plans = selectedTeam.plans ?? [];
  const tasks = teamTasks(selectedTeam);
  const missing = manager?.missing_required_actions ?? [];
  const nextAction =
    missing[0] ?? (plans.length > 0 ? "approve or revise manager plan" : "inspect latest evidence");
  const timeline = timelineForTeam(selectedTeam, plans, tasks, missing);

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
  byId("team-detail-panel").innerHTML = `
    <article class="detail-hero">
      <div>
        <p class="eyebrow">${teamId(selectedTeam)}</p>
        <h3>${manager?.role ?? "manager pending"} coordinating ${workers.length} workers</h3>
        <p class="muted clamp-2">${teamGoal(selectedTeam)}</p>
      </div>
      <div class="next-action">
        <span>Next required action</span>
        <strong>${nextAction}</strong>
      </div>
    </article>

    <div class="detail-grid">
      <section class="detail-panel">
        <div class="subsection-title">
          <h4>Plan</h4>
          <span class="muted">${plans.length} records</span>
        </div>
        <div class="plan-list">
          ${
            plans.length === 0
              ? '<p class="muted">No plan recorded yet.</p>'
              : plans
                  .map(
                    (plan) => `
                      <article>
                        <span class="chip">${plan.plan_id}</span>
                        <strong>${plan.state}</strong>
                        <p class="muted">${plan.worker_count} workers · synthesis ${plan.has_synthesis ? "present" : "missing"}</p>
                      </article>
                    `,
                  )
                  .join("")
          }
        </div>
      </section>

      <section class="detail-panel">
        <div class="subsection-title">
          <h4>Worker tokens</h4>
          <span class="muted">${workers.length} workers</span>
        </div>
        <div class="token-list">
          ${[manager, ...workers]
            .filter(Boolean)
            .map(
              (agent) => `
                <article>
                  <div>
                    <strong>${agent.role}</strong>
                    <p class="muted">${agentName(agent)} · ${agentProvider(agent)} · ${observedTokens(agent).toLocaleString()} / ${tokenBudget(agent).toLocaleString()} tokens</p>
                  </div>
                  <div class="bar" aria-label="${tokenPercent(agent)}% token budget used"><span style="width: ${tokenPercent(agent)}%"></span></div>
                </article>
              `,
            )
            .join("")}
        </div>
      </section>

      <section class="detail-panel timeline-panel">
        <div class="subsection-title">
          <h4>Timeline</h4>
          <span class="muted">${timeline.length} events</span>
        </div>
        <div class="timeline">
          ${timeline
            .map(
              (event) => `
                <article>
                  <span class="timeline-dot ${event.state === "done" ? "ok" : "warn"}"></span>
                  <div>
                    <strong>${event.label}</strong>
                    <p class="muted">${event.detail}</p>
                  </div>
                </article>
              `,
            )
            .join("")}
        </div>
      </section>
    </div>
  `;
};

document.querySelectorAll("[data-team-id]").forEach((element) => {
  const select = () => renderTeamDetail(element.getAttribute("data-team-id") ?? "");
  element.addEventListener("click", select);
  element.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      select();
    }
  });
});

renderTeamDetail(selectedTeamId);

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

const suggestWorkers = (goal) => {
  const normalized = goal.toLowerCase();
  const roles = [
    normalized.includes("ui") || normalized.includes("control plane")
      ? "frontend-control-plane-worker"
      : "implementation-worker",
    normalized.includes("test") || normalized.includes("verify")
      ? "qa-verification-worker"
      : "runtime-verification-worker",
  ];
  return [...new Set(roles)];
};

let latestPlanInput = null;

const persistPlanPreview = async ({ goal, mode, provider, budget, state = "proposed" }) => {
  try {
    const response = await fetch("./api/manager-plan/previews", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ goal, mode, provider, token_budget: budget, state }),
    });
    if (!response.ok) return null;
    const body = await response.json();
    return body?.preview ?? null;
  } catch {
    return null;
  }
};

const loadPersistedPlanPreview = async () => {
  try {
    const response = await fetch("./api/manager-plan/previews", { cache: "no-store" });
    if (!response.ok) return null;
    const body = await response.json();
    return body?.previews?.[0] ?? null;
  } catch {
    return null;
  }
};

const loadLaunchReadiness = async () => {
  try {
    const response = await fetch("./api/manager-plan/launch-readiness", { cache: "no-store" });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
};

const createLaunchIntent = async () => {
  try {
    const response = await fetch("./api/manager-plan/launch-intents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    if (!response.ok) return null;
    const body = await response.json();
    return body?.launch_intent ?? null;
  } catch {
    return null;
  }
};

const renderLaunchIntent = (intent) => {
  if (!intent) return "";
  return `
    <div class="launch-intent">
      <span>Launch intent recorded</span>
      <strong>${escapeHtml(intent.launch_intent_id)}</strong>
      <p class="muted">Local receipt only. No provider call and no worker process has been started.</p>
    </div>
  `;
};

const readinessPanel = (readiness) => {
  if (!readiness) return "";
  return `
    <div class="readiness-panel ${readiness.outcome}">
      <div>
        <span>Launch readiness</span>
        <strong>${escapeHtml(readiness.outcome)}</strong>
      </div>
      ${
        readiness.reasons.length === 0
          ? '<p class="muted">Ready for the next explicit launch step. This panel still launches nothing.</p>'
          : `<ul>${readiness.reasons.map((reason) => `<li>${escapeHtml(reason.message)}</li>`).join("")}</ul>`
      }
      ${
        readiness.outcome === "ready"
          ? '<button type="button" class="secondary launch-intent-button">Record launch intent</button>'
          : ""
      }
    </div>
  `;
};

const renderPersistedPlanPreview = (preview, readiness = null) => {
  byId("plan-preview").innerHTML = `
    <article class="preview-card ${preview.state === "approved-preview" ? "approved-preview" : ""}">
      <div class="section-title">
        <div>
          <p class="eyebrow">Persisted manager plan</p>
          <h4>${escapeHtml(preview.mode)}</h4>
        </div>
        <span class="status-pill small preview-status"><span class="dot ${preview.state === "approved-preview" ? "ok" : "warn"}"></span>${escapeHtml(preview.state)}</span>
      </div>
      <p class="muted">Goal ${escapeHtml(preview.goal_digest)}</p>
      <div class="preview-grid">
        <article>
          <span>Manager</span>
          <strong>${escapeHtml(preview.provider)}</strong>
          <p class="muted">${preview.manager_reserve.toLocaleString()} tokens reserved for plan, synthesis and receipts.</p>
        </article>
        <article>
          <span>Workers proposed</span>
          <strong>${preview.proposed_workers.length}</strong>
          <p class="muted">${preview.proposed_workers.map((worker) => `${worker.role}: ${worker.token_budget.toLocaleString()}`).join(" · ")}</p>
        </article>
        <article>
          <span>Safety reserve</span>
          <strong>${preview.safety_reserve.toLocaleString()}</strong>
          <p class="muted">Held back until operator approval.</p>
        </article>
      </div>
      ${
        preview.receipt_id
          ? `<div class="approval-receipt">
              <span>Persisted local receipt</span>
              <strong>${escapeHtml(preview.receipt_id)}</strong>
              <p class="muted">Stored in the local Control Plane runtime. Workers remain stopped.</p>
            </div>`
          : ""
      }
      ${readinessPanel(readiness)}
    </article>
  `;
};

const renderPlanPreview = async ({ goal, mode, provider, budget }) => {
  latestPlanInput = { goal, mode, provider, budget };
  const persisted = await persistPlanPreview(latestPlanInput);
  const safeBudget = Number.isFinite(budget) && budget > 0 ? Math.floor(budget) : 0;
  const managerReserve = persisted?.manager_reserve ?? Math.floor(safeBudget * 0.25);
  const workerReserve = persisted?.worker_reserve ?? Math.floor(safeBudget * 0.55);
  const safetyReserve =
    persisted?.safety_reserve ?? Math.max(0, safeBudget - managerReserve - workerReserve);
  const workers =
    persisted?.proposed_workers ??
    suggestWorkers(goal).map((worker) => ({
      role: worker,
      token_budget: Math.floor(workerReserve / suggestWorkers(goal).length),
    }));
  const receiptId = persisted?.receipt_id ?? `preview-receipt-${Date.now().toString(36)}`;

  byId("plan-preview").innerHTML = `
    <article class="preview-card" data-preview-receipt-id="${receiptId}">
      <div class="section-title">
        <div>
          <p class="eyebrow">Dry-run manager plan</p>
          <h4>${escapeHtml(mode)}</h4>
        </div>
        <span class="status-pill small preview-status"><span class="dot warn"></span>no workers launched</span>
      </div>
      <p class="muted clamp-2">${escapeHtml(goal)}</p>
      <div class="preview-grid">
        <article>
          <span>Manager</span>
          <strong>${escapeHtml(provider)}</strong>
          <p class="muted">${managerReserve.toLocaleString()} tokens reserved for plan, synthesis and receipts.</p>
        </article>
        <article>
          <span>Workers proposed</span>
          <strong>${workers.length}</strong>
          <p class="muted">${workers.map((worker) => `${worker.role}: ${worker.token_budget.toLocaleString()}`).join(" · ")}</p>
        </article>
        <article>
          <span>Safety reserve</span>
          <strong>${safetyReserve.toLocaleString()}</strong>
          <p class="muted">Held back until operator approval.</p>
        </article>
      </div>
      <ol class="preview-steps">
        <li>Review goal, budget split and proposed workers.</li>
        <li>Approve or edit the plan before any provider call.</li>
        <li>Launch workers only after receipts and limits are visible.</li>
      </ol>
      <div class="preview-actions">
        <button type="button" class="secondary approve-preview-button">Approve plan preview</button>
        <span class="muted">Preview only: no provider call, no worker launch, no external write.</span>
      </div>
      <div class="approval-receipt" hidden></div>
    </article>
  `;
};

byId("plan-preview").addEventListener("click", async (event) => {
  const button = event.target.closest(".approve-preview-button");
  if (!button) return;
  if (latestPlanInput) {
    const approved = await persistPlanPreview({ ...latestPlanInput, state: "approved-preview" });
    if (approved?.receipt_id) {
      button.closest(".preview-card")?.setAttribute("data-preview-receipt-id", approved.receipt_id);
    }
  }

  const card = button.closest(".preview-card");
  const receiptId = card?.getAttribute("data-preview-receipt-id") ?? "preview-receipt";
  card?.classList.add("approved-preview");
  const status = card?.querySelector(".preview-status");
  if (status) {
    status.innerHTML = '<span class="dot ok"></span>approved preview';
  }
  const receipt = card?.querySelector(".approval-receipt");
  if (receipt) {
    receipt.hidden = false;
    receipt.innerHTML = `
      <span>Local preview receipt</span>
      <strong>${escapeHtml(receiptId)}</strong>
      <p class="muted">Recorded only in this browser preview. Workers remain stopped until an explicit real launch is added.</p>
    `;
  }
  button.setAttribute("disabled", "true");
  button.textContent = "Preview approved";
  const readiness = await loadLaunchReadiness();
  if (readiness) {
    card?.insertAdjacentHTML("beforeend", readinessPanel(readiness));
  }
});

byId("plan-preview").addEventListener("click", async (event) => {
  const button = event.target.closest(".launch-intent-button");
  if (!button) return;
  button.setAttribute("disabled", "true");
  const intent = await createLaunchIntent();
  if (!intent) {
    button.removeAttribute("disabled");
    button.textContent = "Launch readiness blocked";
    return;
  }
  button.textContent = "Launch intent recorded";
  button.closest(".readiness-panel")?.insertAdjacentHTML("afterend", renderLaunchIntent(intent));
});

byId("manager-plan-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void renderPlanPreview({
    goal: byId("plan-goal").value.trim() || "Untitled Yukh manager plan",
    mode: byId("plan-mode").value,
    provider: byId("plan-provider").value,
    budget: Number.parseInt(byId("plan-budget").value.replaceAll(/[^\d]/g, ""), 10),
  });
});

const persistedPlan = await loadPersistedPlanPreview();
if (persistedPlan) {
  renderPersistedPlanPreview(persistedPlan, await loadLaunchReadiness());
}
