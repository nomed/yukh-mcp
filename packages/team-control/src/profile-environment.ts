const WORKER_ACTIVITY_ENVIRONMENT = [
  "YUKH_WORKER_ACTIVITY_JETSTREAM",
  "YUKH_NATS_URL",
  "YUKH_WORKER_ACTIVITY_CREATE_STREAM",
  "YUKH_RUNTIME_ENV",
  "YUKH_TENANT",
] as const;

export function inheritedWorkerActivityEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    WORKER_ACTIVITY_ENVIRONMENT.filter((name) => env[name] !== undefined).map(
      (name) => [name, env[name]!] as const,
    ),
  );
}
