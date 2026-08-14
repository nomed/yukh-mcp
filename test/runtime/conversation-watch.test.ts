import assert from "node:assert/strict";
import test from "node:test";
import {
  lifecycleRecords,
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
});
