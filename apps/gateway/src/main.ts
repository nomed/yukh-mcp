import { loadRuntimeConfig } from "../../../packages/config/src/runtime-config.js";
import { createLogger } from "../../../packages/logging/src/logger.js";
import { createGatewayRuntime } from "./server.js";

const logger = createLogger();

try {
  const config = loadRuntimeConfig(process.env);
  const runtime = createGatewayRuntime(config, logger);
  await runtime.listen();

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    const timeout = setTimeout(() => process.exit(1), config.shutdownTimeoutMs);
    timeout.unref();
    try {
      await runtime.close();
      clearTimeout(timeout);
      process.exitCode = 0;
    } catch {
      logger.write("error", "runtime_failure", { code: "internal_error" });
      process.exitCode = 1;
    }
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
} catch {
  logger.write("error", "runtime_failure", { code: "internal_error" });
  process.exitCode = 1;
}
