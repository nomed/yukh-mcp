import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createTopologyStatus } from "./topology-status.js";

type ControlPlaneOptions = {
  readonly host: string;
  readonly port: number;
  readonly staticRoot?: string;
};

const CONTENT_TYPES = new Map([
  ["index.html", "text/html; charset=utf-8"],
  ["styles.css", "text/css; charset=utf-8"],
  ["mock-data.js", "text/javascript; charset=utf-8"],
]);

const API_TOPOLOGY_STATUS_PATH = "/api/topology/status";

export function parseArguments(argv: readonly string[]): ControlPlaneOptions {
  const options = { host: "127.0.0.1", port: 7345 } as {
    host: string;
    port: number;
    staticRoot?: string;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--host" && next) {
      options.host = next;
      i += 1;
    } else if (arg === "--port" && next) {
      const port = Number.parseInt(next, 10);
      if (!Number.isInteger(port) || port < 0 || port > 65_535) {
        throw new TypeError("invalid control plane port");
      }
      options.port = port;
      i += 1;
    } else if (arg === "--static-root" && next) {
      options.staticRoot = next;
      i += 1;
    } else {
      throw new TypeError("invalid control plane arguments");
    }
  }
  return options;
}

export function defaultStaticRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return normalize(join(here, "..", "static"));
}

function requestedFile(url = "/"): string | null {
  const path = new URL(url, "http://127.0.0.1").pathname;
  if (path === "/" || path === "/index.html") return "index.html";
  if (path === "/styles.css") return "styles.css";
  if (path === "/mock-data.js") return "mock-data.js";
  return null;
}

export function createControlPlaneServer(staticRoot = defaultStaticRoot()): Server {
  return createServer(async (request, response) => {
    if (
      request.url &&
      new URL(request.url, "http://127.0.0.1").pathname === API_TOPOLOGY_STATUS_PATH
    ) {
      if (request.method !== "GET") {
        response.writeHead(405, {
          allow: "GET",
          "cache-control": "no-store",
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify({ schema: 1, status: "error", code: "method_not_allowed" }));
        return;
      }
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
      });
      response.end(JSON.stringify(createTopologyStatus()));
      return;
    }

    const file = requestedFile(request.url);
    if (!file) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("not found\n");
      return;
    }
    try {
      const body = await readFile(join(staticRoot, file));
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": CONTENT_TYPES.get(file) ?? "application/octet-stream",
      });
      response.end(body);
    } catch {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end("control plane preview asset unavailable\n");
    }
  });
}

export async function startControlPlane(options: ControlPlaneOptions): Promise<Server> {
  const server = createControlPlaneServer(options.staticRoot);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  return server;
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const options = parseArguments(argv);
  const server = await startControlPlane(options);
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : options.port;
  process.stdout.write(
    `Yukh Control Plane preview: http://${options.host}:${port}\n` +
      "Static mock UI only: no runtime mutations are exposed.\n",
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
