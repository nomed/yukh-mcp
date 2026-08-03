import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { createGatewayRuntime } from "../../gateway/src/server.js";
import { createNodeInspectCapability } from "../../../packages/capabilities/src/node-inspect.js";
import { createLocalReadNodeProvider } from "../../../packages/providers/local-read/src/node-inspect.js";
import { createLogger } from "../../../packages/logging/src/logger.js";

const inputSchema = z
  .object({ node_ref: z.enum(["node-demo", "node-denied"]), path: z.literal("status.txt") })
  .strict();

export interface DemoTranscript {
  readonly mode: "synthetic_local_demo";
  readonly discovery: { readonly tools: readonly string[] };
  readonly allowed: unknown;
  readonly denied: unknown;
  readonly evidence_projection: readonly {
    readonly evidence_ref: string;
    readonly event_type: "authorization.enforcement_recorded.v1";
    readonly effect: "allow" | "deny";
    readonly basis: "explicit";
    readonly subject_ref: "subject_demo";
    readonly policy_ref: "policy_demo_v1";
    readonly classification: "protected";
    readonly durability: "in_memory_demo_only";
  }[];
}

export async function runReadOnlyDemo(): Promise<DemoTranscript> {
  const root = await mkdtemp(join(tmpdir(), "yukh-demo-"));
  try {
    await writeFile(join(root, "status.txt"), "synthetic healthy fixture\n", "utf8");
    const evidence: DemoTranscript["evidence_projection"][number][] = [];
    const provider = await createLocalReadNodeProvider([{ ref: "node-demo", root }]);
    let sequence = 0;
    const capability = createNodeInspectCapability({
      provider,
      authorize: async (request) => {
        const allowed = request.resource.ref === "node-demo";
        const evidence_ref = `evidence_demo_${++sequence}`;
        evidence.push({
          evidence_ref,
          event_type: "authorization.enforcement_recorded.v1",
          effect: allowed ? "allow" : "deny",
          basis: "explicit",
          subject_ref: "subject_demo",
          policy_ref: "policy_demo_v1",
          classification: "protected",
          durability: "in_memory_demo_only",
        });
        return { allowed, evidence_ref };
      },
    });

    const createDemoServer = () => {
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
    };

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
      createDemoServer,
    );
    const { port } = await runtime.listen();
    const client = new Client({ name: "yukh-demo-client", version: "1.0.0" });
    try {
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)),
      );
      const tools = (await client.listTools()).tools.map(({ name }) => name).sort();
      const allowed = await client.callTool({
        name: "node.inspect",
        arguments: { node_ref: "node-demo", path: "status.txt" },
      });
      const denied = await client.callTool({
        name: "node.inspect",
        arguments: { node_ref: "node-denied", path: "status.txt" },
      });
      return {
        mode: "synthetic_local_demo",
        discovery: { tools },
        allowed,
        denied,
        evidence_projection: evidence,
      };
    } finally {
      await client.close();
      await runtime.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
