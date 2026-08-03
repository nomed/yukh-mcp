import { z } from "zod";

const hostname = z
  .string()
  .min(1)
  .max(253)
  .regex(/^(?:localhost|\[[0-9a-fA-F:]+\]|[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?)$/);

const runtimeConfigSchema = z
  .object({
    host: z.enum(["127.0.0.1", "::1", "0.0.0.0", "::"]),
    port: z.number().int().min(0).max(65535),
    allowedHosts: z.array(hostname).min(1).max(32),
    allowedOrigins: z.array(z.url().max(2048)).max(32),
    maxBodyBytes: z.number().int().min(1024).max(1_048_576),
    shutdownTimeoutMs: z.number().int().min(100).max(30_000),
  })
  .strict();

export interface RuntimeConfig extends Omit<
  z.infer<typeof runtimeConfigSchema>,
  "allowedHosts" | "allowedOrigins"
> {
  readonly allowedHosts: readonly string[];
  readonly allowedOrigins: readonly string[];
}

function integer(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!/^(?:0|[1-9][0-9]*)$/.test(value))
    throw new TypeError(`${name} must be an unsigned base-10 integer`);
  return Number(value);
}

function list(value: string | undefined, fallback: string[]): string[] {
  if (value === undefined) return fallback;
  return [
    ...new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

export function loadRuntimeConfig(environment: NodeJS.ProcessEnv): RuntimeConfig {
  const host = environment.YUKH_HOST ?? "127.0.0.1";
  const defaults = host === "::1" ? ["[::1]", "localhost"] : ["127.0.0.1", "localhost"];
  const result = runtimeConfigSchema.safeParse({
    host,
    port: integer("YUKH_PORT", environment.YUKH_PORT, 3000),
    allowedHosts: list(environment.YUKH_ALLOWED_HOSTS, defaults),
    allowedOrigins: list(environment.YUKH_ALLOWED_ORIGINS, []),
    maxBodyBytes: integer("YUKH_MAX_BODY_BYTES", environment.YUKH_MAX_BODY_BYTES, 65_536),
    shutdownTimeoutMs: integer(
      "YUKH_SHUTDOWN_TIMEOUT_MS",
      environment.YUKH_SHUTDOWN_TIMEOUT_MS,
      5_000,
    ),
  });
  if (!result.success) {
    const paths = result.error.issues
      .map(({ path }) => path.join("."))
      .sort()
      .join(",");
    throw new TypeError(`invalid runtime configuration: ${paths}`);
  }
  if ((host === "0.0.0.0" || host === "::") && environment.YUKH_ALLOWED_HOSTS === undefined) {
    throw new TypeError("YUKH_ALLOWED_HOSTS is required for a non-loopback bind");
  }
  return Object.freeze({
    ...result.data,
    allowedHosts: Object.freeze([...result.data.allowedHosts]),
    allowedOrigins: Object.freeze([...result.data.allowedOrigins]),
  });
}
