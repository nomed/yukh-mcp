import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  McpServer,
  createMcpHandler,
  hostHeaderValidationResponse,
} from "@modelcontextprotocol/server";
import type { RuntimeConfig } from "../../../packages/config/src/runtime-config.js";
import { createLogger, type Logger } from "../../../packages/logging/src/logger.js";

export interface GatewayRuntime {
  listen(): Promise<{ host: string; port: number }>;
  close(): Promise<void>;
  address(): { host: string; port: number } | null;
}

class RequestTooLargeError extends Error {}

function correlationRef(): string {
  return `request_${randomUUID().replaceAll("-", "")}`;
}

async function readBody(
  request: IncomingMessage,
  maximum: number,
): Promise<Uint8Array | undefined> {
  if (request.method === "GET" || request.method === "HEAD" || request.method === "DELETE")
    return undefined;
  const declared = Number(request.headers["content-length"]);
  if (Number.isFinite(declared) && declared > maximum) throw new RequestTooLargeError();
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.length;
    if (length > maximum) throw new RequestTooLargeError();
    chunks.push(bytes);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

function originRejected(request: Request, allowedOrigins: readonly string[]): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) return false;
  return !allowedOrigins.includes(origin);
}

async function writeWebResponse(response: Response, target: ServerResponse): Promise<void> {
  target.statusCode = response.status;
  for (const [name, value] of response.headers) target.setHeader(name, value);
  target.end(Buffer.from(await response.arrayBuffer()));
}

function json(target: ServerResponse, status: number, value: object): void {
  const body = JSON.stringify(value);
  target.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  target.end(body);
}

function createInertMcpServer(): McpServer {
  return new McpServer(
    { name: "yukh-mcp", version: "0.0.0" },
    {
      capabilities: {
        tools: { listChanged: false },
        resources: { listChanged: false, subscribe: false },
        prompts: { listChanged: false },
      },
    },
  );
}

export function createGatewayRuntime(
  config: RuntimeConfig,
  logger: Logger = createLogger(),
): GatewayRuntime {
  let ready = false;
  const mcp = createMcpHandler(() => createInertMcpServer(), { legacy: "stateless" });
  const server: Server = createServer(async (request, response) => {
    const correlation_ref = correlationRef();
    response.setHeader("x-request-id", correlation_ref);
    try {
      const pathname = new URL(request.url ?? "/", "http://runtime.invalid").pathname;
      if (request.method === "GET" && pathname === "/healthz") {
        json(response, 200, { status: "ok" });
      } else if (request.method === "GET" && pathname === "/readyz") {
        json(response, ready ? 200 : 503, { status: ready ? "ready" : "not_ready" });
      } else if (pathname === "/mcp") {
        if (request.method !== "POST") {
          response.setHeader("allow", "POST");
          logger.write("warn", "request_rejected", {
            correlation_ref,
            status: 405,
            code: "method_not_allowed",
          });
          json(response, 405, { error: "method_not_allowed" });
          return;
        }
        const body = await readBody(request, config.maxBodyBytes);
        const headers = new Headers();
        for (const [name, value] of Object.entries(request.headers)) {
          if (value !== undefined)
            headers.set(name, Array.isArray(value) ? value.join(",") : value);
        }
        const webRequest = new Request(
          `http://${config.host === "::" ? "[::]" : config.host}:${config.port}/mcp`,
          {
            method: request.method ?? "GET",
            headers,
            ...(body === undefined ? {} : { body: Buffer.from(body) }),
          },
        );
        const hostRejection = hostHeaderValidationResponse(webRequest, [...config.allowedHosts]);
        if (hostRejection) {
          logger.write("warn", "request_rejected", {
            correlation_ref,
            status: hostRejection.status,
            code: "host_rejected",
          });
          await writeWebResponse(hostRejection, response);
          return;
        }
        if (originRejected(webRequest, config.allowedOrigins)) {
          logger.write("warn", "request_rejected", {
            correlation_ref,
            status: 403,
            code: "origin_rejected",
          });
          json(response, 403, { error: "origin_not_allowed" });
          return;
        }
        await writeWebResponse(await mcp.fetch(webRequest), response);
      } else {
        logger.write("warn", "request_rejected", {
          correlation_ref,
          status: 404,
          code: "route_not_found",
        });
        json(response, 404, { error: "not_found" });
        return;
      }
      logger.write("info", "request_completed", { correlation_ref, status: response.statusCode });
    } catch (error) {
      if (error instanceof RequestTooLargeError) {
        logger.write("warn", "request_rejected", {
          correlation_ref,
          status: 413,
          code: "body_too_large",
        });
        json(response, 413, { error: "request_too_large" });
      } else {
        logger.write("error", "runtime_failure", {
          correlation_ref,
          status: 500,
          code: "internal_error",
        });
        if (!response.headersSent) json(response, 500, { error: "internal_error" });
        else response.destroy();
      }
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 5_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 100;
  server.maxConnections = 128;

  return {
    async listen() {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(config.port, config.host, () => {
          server.off("error", reject);
          resolve();
        });
      });
      ready = true;
      const bound = server.address();
      if (!bound || typeof bound === "string")
        throw new Error("runtime did not bind a TCP address");
      logger.write("info", "runtime_started");
      return { host: config.host, port: bound.port };
    },
    async close() {
      ready = false;
      logger.write("info", "runtime_stopping");
      await mcp.close();
      if (server.listening)
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      logger.write("info", "runtime_stopped");
    },
    address() {
      const bound = server.address();
      return bound && typeof bound !== "string" ? { host: config.host, port: bound.port } : null;
    },
  };
}
