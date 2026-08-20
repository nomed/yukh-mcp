#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { connect } from "node:net";
import { URL } from "node:url";

const runtime = process.env.YUKH_PREVIEW_RUNTIME ?? "/run/yukh";
const natsUrl = process.env.YUKH_NATS_URL ?? "nats://nats:4222";
const supervisorUrl =
  process.env.YUKH_COORDINATION_SUPERVISOR_URL ??
  "https://coordinator:7444/local-preview/v1/config";
const problems = [];
const warnings = [];
const checks = new Map();

const report = (line) => {
  process.stdout.write(`${line}\n`);
};
const problem = (message) => {
  problems.push(message);
  report(`problem: ${message}`);
};
const warning = (message) => {
  warnings.push(message);
  report(`warning: ${message}`);
};

const tcpReachable = async (url) =>
  new Promise((resolve) => {
    const parsed = new URL(url);
    const socket = connect(
      {
        host: parsed.hostname,
        port: Number.parseInt(parsed.port || "4222", 10),
        timeout: 2000,
      },
      () => {
        socket.destroy();
        resolve(true);
      },
    );
    socket.once("error", () => resolve(false));
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });

report("yukh-preview-runtime-check");
report(`runtime: ${runtime}`);
report("launcher: compose-local-suite");
checks.set("runtime_mode", "compose-volume");

for (const file of [
  "coordinator.json",
  "server.crt",
  "server.key",
  "supervisor.token",
  "receipt-signing.key",
]) {
  try {
    await readFile(`${runtime}/${file}`);
    checks.set(file, "present");
  } catch {
    problem(`missing ${runtime}/${file}`);
  }
}

checks.set("nats_url", natsUrl);
if (await tcpReachable(natsUrl)) {
  checks.set("nats", "ok");
} else {
  problem(`NATS unavailable at ${natsUrl}`);
}

checks.set("coordination_supervisor_url", supervisorUrl);
const parsedSupervisor = new URL(supervisorUrl);
const supervisorTcpUrl = `tcp://${parsedSupervisor.hostname}:${parsedSupervisor.port || "7444"}`;
if (await tcpReachable(supervisorTcpUrl)) {
  checks.set("coordination_supervisor_tcp", "ok");
} else {
  warning(`Coordination supervisor TCP endpoint unavailable at ${supervisorTcpUrl}`);
}

for (const [key, value] of checks) report(`${key}: ${value}`);

if (problems.length > 0) {
  report("status: attention-required");
  process.exit(2);
}
if (warnings.length > 0) {
  report("status: ok-with-warnings");
} else {
  report("status: ok");
}
