import { z } from "zod";

const requestSchema = z
  .object({
    request_version: z.literal(1),
    request_id: z.string().min(1).max(128),
    capability: z.object({ id: z.literal("node.inspect"), version: z.literal("1.0.0") }).strict(),
    resource: z.object({ kind: z.literal("node"), ref: z.string().min(1).max(128) }).strict(),
    environment: z.string().min(1).max(128),
    input: z.object({ path: z.string().min(1).max(512) }).strict(),
    idempotency_key: z.null(),
  })
  .strict();

const outputSchema = z
  .object({
    source: z
      .object({
        node_ref: z.string().min(1).max(128),
        relative_path: z.string().min(1).max(512),
      })
      .strict(),
    observed_at: z.iso.datetime(),
    freshness_seconds: z.number().int().min(0).max(86_400),
    entry: z
      .object({
        kind: z.enum(["file", "directory"]),
        size_bytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
        modified_at: z.iso.datetime(),
      })
      .strict(),
  })
  .strict();

export function validNodeInspectRequest(value: unknown): boolean {
  return requestSchema.safeParse(value).success;
}

export function validNodeInspectOutput(value: unknown): boolean {
  return (
    outputSchema.safeParse(value).success &&
    Buffer.byteLength(JSON.stringify(value), "utf8") <= 4_096
  );
}
