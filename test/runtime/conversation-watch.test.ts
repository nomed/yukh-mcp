import assert from "node:assert/strict";
import test from "node:test";
import {
  lifecycleRecords,
  recordIsVisible,
  renderLifecycle,
  renderRecord,
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
});
