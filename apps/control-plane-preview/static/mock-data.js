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
const activeTeams = data.teams.filter((team) => team.state !== "complete");
const agents = data.teams.flatMap((team) => team.agents);
const used = data.teams.reduce((sum, team) => sum + team.budget.used, 0);
const allocated = data.teams.reduce((sum, team) => sum + team.budget.allocated, 0);

byId("workspace-name").textContent = data.workspace;
byId("metric-teams").textContent = String(activeTeams.length);
byId("metric-agents").textContent = String(agents.length);
byId("metric-budget").textContent = `${Math.round((used / allocated) * 100)}% used`;
byId("metric-providers").textContent = "CLI + SDK";

byId("team-list").innerHTML = data.teams
  .map(
    (team) => `
      <article class="team-row">
        <div>
          <p class="eyebrow">${team.mode}</p>
          <h3>${team.id}</h3>
          <p class="muted">${team.goal}</p>
          <div class="agent-stack">
            ${team.agents
              .map(
                (agent) =>
                  `<span class="chip ${agent.state === "answered" ? "good" : ""}">${agent.name}: ${agent.provider}</span>`,
              )
              .join("")}
          </div>
        </div>
        <span class="status-pill small"><span class="dot ${team.state === "complete" ? "ok" : "warn"}"></span>${team.state}</span>
      </article>
    `,
  )
  .join("");

byId("budget-panel").innerHTML = data.teams
  .map((team) => {
    const percentage = Math.round((team.budget.used / team.budget.allocated) * 100);
    return `
      <article class="budget-row">
        <div class="section-title">
          <strong>${team.id}</strong>
          <span class="muted">${team.budget.used.toLocaleString()} / ${team.budget.allocated.toLocaleString()}</span>
        </div>
        <div class="bar" aria-label="${percentage}% token budget used"><span style="width: ${percentage}%"></span></div>
        <span class="muted">Reserved: ${team.budget.reserved.toLocaleString()} tokens</span>
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
