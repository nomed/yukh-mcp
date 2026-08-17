import assert from "node:assert/strict";
import test from "node:test";
import {
  lifecycleRecords,
  recordIsVisible,
  renderLifecycle,
  renderRecord,
  renderTeamChanges,
  watchRecords,
} from "../../packages/conversation-watch/src/watch.js";

const eventID = "019fffc0-06d7-7bbf-8f28-a60641591e1f";
const receiptID = "019fffc0-ffef-7e44-b392-bf7a62f9b665";
const output = {
  schema: 1 as const,
  status: "ok" as const,
  command: "events replay",
  result: {
    records: [
      {
        sequence: 2,
        event: {
          id: eventID,
          type: "question",
          time: "2026-08-14T12:01:05.929Z",
          participant: { id: "agent:a" },
          data: { body: "Build the frontend", requested_from: ["agent:b"] },
        },
        receipt: { receipt_id: receiptID },
      },
    ],
  },
};

test("watch renders verified conversation once with optional evidence", () => {
  const records = watchRecords(output, 0);
  assert.equal(records.length, 1);
  assert.equal(watchRecords(output, 2).length, 0);
  assert.equal(
    renderRecord(records[0]!, false),
    "12:01:05  agent:a → agent:b  QUESTION\n         Build the frontend",
  );
  assert.match(
    renderRecord(records[0]!, true),
    new RegExp(`event=${eventID} receipt=${receiptID}`),
  );
});

test("watch explains team and worker activity in work-oriented language", () => {
  const changes = renderTeamChanges(
    [
      {
        team: {
          schema: 1,
          team_id: "team-0eae0789-0d76-493a-9d89-2f44c9f819cd",
          goal: "Build a task board",
          workspace: "/tmp/project",
          manager_runtime: "codex",
          max_agents: 3,
          max_depth: 2,
          token_budget: 200_000,
          state: "active",
        },
        agents: [
          {
            schema: 1,
            agent_id: "worker-9776aa63-2b13-4d98-ab2b-5b0c8b0354aa",
            kind: "worker",
            coordination_agent: "agent-backend-lead-61e1f378",
            coordination_participant: "agent:backend-lead-61e1f378",
            team_id: "team-0eae0789-0d76-493a-9d89-2f44c9f819cd",
            runtime: "codex",
            role: "backend-lead",
            task: "Define and implement the API",
            depth: 1,
            can_spawn: true,
            token_budget: 50_000,
            max_commands: 6,
            timeout_ms: 120_000,
            required_actions: [],
            state: "running",
          },
        ],
        receipts: [],
        tokens: {
          budget: 200_000,
          allocated: 50_000,
          observed: 0,
          remaining: 200_000,
          pending_agents: 1,
          unaccounted_agents: 0,
          exceeded_agents: 0,
        },
      },
    ],
    new Map(),
  );
  assert.match(changes.join("\n"), /TEAM  team-0eae0789.*ACTIVE  goal=Build a task board/u);
  assert.match(changes.join("\n"), /manager=manager runtime=codex agents=1 receipts=0/u);
  assert.match(changes.join("\n"), /TIMELINE  WORKER backend-lead  RUNNING  status=working/u);
  assert.match(changes.join("\n"), /task=Define and implement the API/u);
  assert.match(changes.join("\n"), /tools=default bounds=commands:6 timeout_ms:120000/u);
});

test("watch exposes manager accounting and receipt-backed actions", () => {
  const teamID = "team-0eae0789-0d76-493a-9d89-2f44c9f819cd";
  const managerID = "worker-9776aa63-2b13-4d98-ab2b-5b0c8b0354aa";
  const changes = renderTeamChanges(
    [
      {
        team: {
          schema: 1,
          team_id: teamID,
          goal: "Improve Yukh",
          workspace: "/tmp/project",
          manager_runtime: "codex",
          manager_role: "delivery-manager",
          manager_mission: "Deliver one verified increment",
          max_agents: 3,
          max_depth: 2,
          token_budget: 60_000,
          state: "active",
        },
        agents: [
          {
            schema: 1,
            agent_id: managerID,
            kind: "manager",
            coordination_agent: "agent-delivery-manager-61e1f378",
            coordination_participant: "agent:delivery-manager-61e1f378",
            team_id: teamID,
            runtime: "codex",
            role: "delivery-manager",
            task: "Inspect and report",
            depth: 0,
            can_spawn: true,
            token_budget: 20_000,
            required_actions: ["team.status"],
            usage: {
              schema: 1,
              source: "codex-json-v1",
              input_tokens: 5_000,
              cached_input_tokens: 3_000,
              output_tokens: 500,
              reasoning_output_tokens: 100,
              total_tokens: 5_500,
              budget_outcome: "within",
            },
            completion: { schema: 1, outcome: "succeeded", summary: "Verified" },
            state: "completed",
          },
        ],
        receipts: [
          {
            schema: 1,
            receipt_id: "receipt-9776aa63-2b13-4d98-ab2b-5b0c8b0354aa",
            team_id: teamID,
            action: "team.status",
            actor_agent_id: managerID,
            subject_agent_id: managerID,
            outcome: "succeeded",
          },
        ],
        plans: [
          {
            schema: 1,
            plan_id: "plan-9776aa63-2b13-4d98-ab2b-5b0c8b0354aa",
            team_id: teamID,
            manager_agent_id: managerID,
            digest: `sha-256:${"1".repeat(64)}`,
            document: {
              schema: 1,
              workers: [
                {
                  runtime: "codex",
                  role: "backend-developer",
                  mission: "Implement",
                  model: "default",
                  skills: [],
                  instructions: "Implement and test.",
                  task: "Deliver one increment.",
                  context_paths: [],
                  tool_mode: "none",
                  max_commands: 4,
                  timeout_ms: 60_000,
                  token_budget: 20_000,
                },
              ],
              synthesis: {
                runtime: "codex",
                role: "delivery-synthesizer",
                mission: "Summarize",
                model: "default",
                skills: [],
                instructions: "Use verified evidence.",
                task: "Summarize the delivery.",
                context_paths: [],
                tool_mode: "none",
                max_commands: 0,
                timeout_ms: 60_000,
                token_budget: 5_000,
              },
            },
            state: "running",
            worker_agent_ids: ["worker-3dc1c6d1-ac73-4f39-9d48-301123385534"],
            synthesis_agent_id: "worker-4dc1c6d1-ac73-4f39-9d48-301123385534",
          },
        ],
        tokens: {
          budget: 60_000,
          allocated: 20_000,
          observed: 5_500,
          remaining: 54_500,
          pending_agents: 0,
          unaccounted_agents: 0,
          exceeded_agents: 0,
        },
      },
    ],
    new Map(),
  ).join("\n");
  assert.match(changes, /TIMELINE  MANAGER delivery-manager  COMPLETED  status=succeeded/u);
  assert.match(changes, /input=5000 cached=3000 output=500 reasoning=100/u);
  assert.match(changes, /required=team.status missing=none receipts=team.status/u);
  assert.match(changes, /PLAN  plan-9776aa63-2b13-4d98-ab2b-5b0c8b0354aa  RUNNING/u);
  assert.match(changes, /workers=1 synthesis=worker-4dc1c6d1/u);
});

test("watch status names only missing required receipts", () => {
  const teamID = "team-0eae0789-0d76-493a-9d89-2f44c9f819cd";
  const managerID = "worker-9776aa63-2b13-4d98-ab2b-5b0c8b0354aa";
  const changes = renderTeamChanges(
    [
      {
        team: {
          schema: 1,
          team_id: teamID,
          goal: "Track missing receipts",
          workspace: "/tmp/project",
          manager_runtime: "codex",
          manager_role: "delivery-manager",
          manager_mission: "Keep operator status precise",
          max_agents: 3,
          max_depth: 2,
          token_budget: 60_000,
          state: "active",
        },
        agents: [
          {
            schema: 1,
            agent_id: managerID,
            kind: "manager",
            coordination_agent: "agent-delivery-manager-61e1f378",
            coordination_participant: "agent:delivery-manager-61e1f378",
            team_id: teamID,
            runtime: "codex",
            role: "delivery-manager",
            task: "Prepare and engage a worker",
            depth: 0,
            can_spawn: true,
            token_budget: 20_000,
            required_actions: ["policy.profile", "agent.engage"],
            max_commands: 0,
            timeout_ms: 60_000,
            state: "defined",
          },
        ],
        receipts: [
          {
            schema: 1,
            receipt_id: "receipt-9776aa63-2b13-4d98-ab2b-5b0c8b0354aa",
            team_id: teamID,
            action: "agent.engage",
            actor_agent_id: managerID,
            subject_agent_id: "worker-3dc1c6d1-ac73-4f39-9d48-301123385534",
            outcome: "succeeded",
          },
        ],
        plans: [],
        tokens: {
          budget: 60_000,
          allocated: 20_000,
          observed: 0,
          remaining: 60_000,
          pending_agents: 1,
          unaccounted_agents: 0,
          exceeded_agents: 0,
        },
      },
    ],
    new Map(),
  ).join("\n");
  assert.match(changes, /status=waiting:policy\.profile/u);
  assert.match(changes, /missing=policy\.profile receipts=agent\.engage/u);
  assert.doesNotMatch(changes, /status=waiting:policy\.profile,agent\.engage/u);
});

test("watch marks over-budget summaries as reviewable", () => {
  const changes = renderTeamChanges(
    [
      {
        team: {
          schema: 1,
          team_id: "team-0eae0789-0d76-493a-9d89-2f44c9f819cd",
          goal: "Review over-budget output",
          workspace: "/tmp/project",
          manager_runtime: "codex",
          manager_role: "delivery-manager",
          manager_mission: "Keep useful failed output visible",
          max_agents: 2,
          max_depth: 1,
          token_budget: 20_000,
          state: "active",
        },
        agents: [
          {
            schema: 1,
            agent_id: "worker-3dc1c6d1-ac73-4f39-9d48-301123385534",
            kind: "worker",
            coordination_agent: "agent-suite-planner-61e1f378",
            coordination_participant: "agent:suite-planner-61e1f378",
            team_id: "team-0eae0789-0d76-493a-9d89-2f44c9f819cd",
            runtime: "codex",
            role: "suite-planner",
            task: "Return a concise proposal",
            depth: 1,
            can_spawn: false,
            token_budget: 8_000,
            required_actions: [],
            usage: {
              schema: 1,
              source: "codex-json-v1",
              input_tokens: 14_869,
              cached_input_tokens: 9_984,
              output_tokens: 783,
              reasoning_output_tokens: 143,
              total_tokens: 15_652,
              budget_outcome: "exceeded",
            },
            completion: {
              schema: 1,
              outcome: "token_budget_exceeded",
              summary: "Useful proposal preserved for review",
            },
            state: "failed",
          },
        ],
        receipts: [],
        plans: [],
        tokens: {
          budget: 20_000,
          allocated: 8_000,
          observed: 15_652,
          remaining: 4_348,
          pending_agents: 0,
          unaccounted_agents: 0,
          exceeded_agents: 1,
        },
      },
    ],
    new Map(),
  ).join("\n");
  assert.match(changes, /status=token_budget_exceeded review=summary_available/u);
  assert.match(changes, /summary=Useful proposal preserved for review/u);
});

test("watch accepts bounded dynamic team identities", () => {
  const dynamic = structuredClone(output);
  dynamic.result.records[0]!.event.participant.id = "agent:frontend-developer-a1b2c3d4";
  assert.equal(
    watchRecords(dynamic, 0)[0]?.event.participant.id,
    "agent:frontend-developer-a1b2c3d4",
  );
  const lifecycle = lifecycleRecords(
    `${JSON.stringify({ schema: 1, event: "agent_started", agent: "agent-frontend-developer-a1b2c3d4", question_event_id: eventID, turn: 1 })}\n`,
    0,
  );
  assert.equal(lifecycle[0]?.agent, "agent-frontend-developer-a1b2c3d4");
});

test("watch compacts long messages and can render their full body", () => {
  const record = structuredClone(watchRecords(output, 0)[0]!);
  const body = `Frontend implementation request:\n${"Create accessible components. ".repeat(12)}`;
  (record.event.data as { body: string }).body = body;
  const compact = renderRecord(record, false);
  assert.equal(compact.includes("\n         Create accessible"), false);
  assert.match(compact, /…$/u);
  assert.match(renderRecord(record, false, true), /\n         Create accessible components\./u);
});

test("watch links answers to questions and hides repeated joins", () => {
  const answer = structuredClone(watchRecords(output, 0)[0]!);
  (answer.event as { type: string }).type = "answer";
  (answer.event.data as Record<string, unknown>).question_event_id = eventID;
  assert.match(renderRecord(answer, false), new RegExp(`↳ question=${eventID}`));

  const join = structuredClone(answer);
  (join.event as { type: string }).type = "join";
  const present = new Set<string>();
  assert.equal(recordIsVisible(join, present), true);
  assert.equal(recordIsVisible(join, present), false);
  (join.event as { type: string }).type = "leave";
  assert.equal(recordIsVisible(join, present), true);
  (join.event as { type: string }).type = "join";
  assert.equal(recordIsVisible(join, present), true);
});

test("watch rejects malformed or unverified transcript records", () => {
  assert.throws(
    () =>
      watchRecords(
        { schema: 1, status: "ok", command: "events replay", result: { records: [{}] } },
        0,
      ),
    /coordination_protocol_error/u,
  );
});

test("watch renders closed coordinator lifecycle without message content", () => {
  const raw = `${JSON.stringify({ schema: 1, event: "agent_started", agent: "agent-b", question_event_id: eventID, turn: 1 })}\n`;
  const records = lifecycleRecords(raw, 0);
  assert.equal(records.length, 1);
  assert.equal(lifecycleRecords(raw, 1).length, 0);
  assert.equal(
    renderLifecycle(records[0]!),
    `COORDINATOR  agent-b  AGENT STARTED  turn=1 question=${eventID}`,
  );
  assert.throws(() => lifecycleRecords('{"schema":1,"event":"unknown"}\n', 0));
  const failure = lifecycleRecords(
    `${JSON.stringify({ schema: 1, event: "agent_failed", agent: "agent-b", question_event_id: eventID, turn: 2, failure_code: "agent_exit_nonzero" })}\n`,
    0,
  );
  assert.match(renderLifecycle(failure[0]!), /failure=agent_exit_nonzero$/u);
  assert.equal(
    renderLifecycle(lifecycleRecords('{"schema":1,"event":"coordinator_unavailable"}\n', 0)[0]!),
    "COORDINATOR  COORDINATION TEMPORARILY UNAVAILABLE — RETRYING",
  );
  assert.equal(
    renderLifecycle(lifecycleRecords('{"schema":1,"event":"coordinator_recovered"}\n', 0)[0]!),
    "COORDINATOR  COORDINATION RECOVERED",
  );
  assert.equal(
    renderLifecycle(
      lifecycleRecords(
        '{"schema":1,"event":"coordinator_coordination_failed","coordination_action":"bootstrap","ykc_code":"YKC-CUSTODY-001"}\n',
        0,
      )[0]!,
    ),
    "COORDINATOR  COORDINATION BOOTSTRAP FAILED code=YKC-CUSTODY-001 — RETRYING",
  );
});
