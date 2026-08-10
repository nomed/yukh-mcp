import { createNodeInspectCapability } from "../../../packages/capabilities/src/node-inspect.js";
import { createLogger } from "../../../packages/logging/src/logger.js";
import { createLocalReadNodeProvider } from "../../../packages/providers/local-read/src/node-inspect.js";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { createGatewayRuntime } from "../../gateway/src/server.js";
import type { DemoEvidence } from "./demo.js";

const root = process.argv[2];
if (!root || process.argv.length !== 3) throw new Error("invalid demo server configuration");

const inputSchema = z
  .object({ node_ref: z.enum(["node-demo", "node-denied"]), path: z.literal("status.txt") })
  .strict();
const provider = await createLocalReadNodeProvider([{ ref: "node-demo", root }]);
let sequence = 0;
const capability = createNodeInspectCapability({
  provider,
  authorize: async (request) => {
    const allowed = request.resource.ref === "node-demo";
    const evidence_ref = `evidence_demo_${++sequence}`;
    const evidence: DemoEvidence = {
      evidence_ref,
      event_type: "authorization.enforcement_recorded.v1",
      effect: allowed ? "allow" : "deny",
      basis: "explicit",
      subject_ref: "subject_demo",
      policy_ref: "policy_demo_v1",
      classification: "protected",
      durability: "in_memory_demo_only",
    };
    process.stdout.write(`${JSON.stringify({ type: "evidence", evidence })}\n`);
    return { allowed, evidence_ref };
  },
});

const runtime = createGatewayRuntime(
  {
    host: "127.0.0.1",
    port: 0,
    allowedHosts: ["127.0.0.1"],
    allowedOrigins: [],
    maxBodyBytes: 8_192,
    shutdownTimeoutMs: 1_000,
  },
  createLogger({ sink: () => undefined }),
  () => {
    const server = new McpServer({ name: "yukh-mcp-demo", version: "0.0.0" });
    server.registerTool(
      "node.inspect",
      {
        title: "Inspect synthetic demo node",
        description: "Read bounded metadata from the synthetic local demo fixture",
        inputSchema,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      },
      async ({ node_ref, path }) => {
        const result = await capability.invoke({
          request_version: 1,
          request_id: `req_demo_${sequence + 1}`,
          capability: { id: "node.inspect", version: "1.0.0" },
          resource: { kind: "node", ref: node_ref },
          environment: "demo",
          input: { path },
          idempotency_key: null,
        });
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: { result },
          isError: result.status !== "succeeded",
        };
      },
    );
    return server;
  },
);

const { port } = await runtime.listen();
process.stdout.write(`${JSON.stringify({ type: "ready", port })}\n`);

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  try {
    await runtime.close();
    process.stdout.write('{"type":"stopped"}\n');
    process.exitCode = 0;
  } catch {
    process.exitCode = 1;
  } finally {
    process.disconnect();
  }
};
process.on("message", (message: unknown) => {
  if (
    message &&
    typeof message === "object" &&
    Object.keys(message).length === 1 &&
    (message as { type?: unknown }).type === "stop"
  )
    void stop();
});
