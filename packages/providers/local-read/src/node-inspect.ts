import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export const NODE_INSPECT_IMPLEMENTATION_REF = "impl_local_read_node_inspect_v1";

export interface LocalNodeConfig {
  readonly ref: string;
  readonly root: string;
}
export interface NodeInspectInput {
  readonly path: string;
}
export interface NodeInspectOutput {
  readonly source: { readonly node_ref: string; readonly relative_path: string };
  readonly observed_at: string;
  readonly freshness_seconds: number;
  readonly entry: {
    readonly kind: "file" | "directory";
    readonly size_bytes: number;
    readonly modified_at: string;
  };
}

export class LocalReadProviderError extends Error {
  constructor(readonly code: "invalid_path" | "not_found" | "unsupported_entry") {
    super(code);
    this.name = "LocalReadProviderError";
  }
}

export interface LocalReadNodeProvider {
  inspect(nodeRef: string, input: NodeInspectInput): Promise<NodeInspectOutput>;
}

interface CanonicalNode {
  readonly ref: string;
  readonly root: string;
}
const nodeRefPattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

function validRelativePath(value: string): boolean {
  return (
    value.length > 0 &&
    Buffer.byteLength(value, "utf8") <= 512 &&
    !isAbsolute(value) &&
    !/[\u0000-\u001f\u007f]/u.test(value) &&
    value.split(/[\\/]/u).every((part) => part.length > 0 && part !== "." && part !== "..")
  );
}

function contained(root: string, target: string): boolean {
  const fromRoot = relative(root, target);
  return (
    fromRoot === "" ||
    (!fromRoot.startsWith(`..${sep}`) && fromRoot !== ".." && !isAbsolute(fromRoot))
  );
}

export async function createLocalReadNodeProvider(
  configs: readonly LocalNodeConfig[],
  options: { readonly now?: () => Date } = {},
): Promise<LocalReadNodeProvider> {
  if (configs.length === 0 || configs.length > 32)
    throw new TypeError("invalid node configuration");
  const nodes = new Map<string, CanonicalNode>();
  for (const config of configs) {
    if (!nodeRefPattern.test(config.ref) || nodes.has(config.ref))
      throw new TypeError("invalid node configuration");
    const root = await realpath(config.root);
    if (!(await lstat(root)).isDirectory()) throw new TypeError("invalid node configuration");
    nodes.set(config.ref, { ref: config.ref, root });
  }
  const now = options.now ?? (() => new Date());
  return Object.freeze({
    async inspect(nodeRef: string, input: NodeInspectInput): Promise<NodeInspectOutput> {
      const node = nodes.get(nodeRef);
      if (!node || !validRelativePath(input.path)) throw new LocalReadProviderError("invalid_path");
      const target = resolve(node.root, input.path);
      if (!contained(node.root, target)) throw new LocalReadProviderError("invalid_path");
      let current = node.root;
      let metadata;
      try {
        for (const component of input.path.split(/[\\/]/u)) {
          current = resolve(current, component);
          const candidate = await lstat(current);
          if (candidate.isSymbolicLink()) throw new LocalReadProviderError("invalid_path");
          metadata = candidate;
        }
      } catch (error) {
        if (error instanceof LocalReadProviderError) throw error;
        throw new LocalReadProviderError("not_found");
      }
      if (!metadata) throw new LocalReadProviderError("not_found");
      if (!contained(node.root, await realpath(target)))
        throw new LocalReadProviderError("invalid_path");
      const kind = metadata.isFile() ? "file" : metadata.isDirectory() ? "directory" : null;
      if (!kind) throw new LocalReadProviderError("unsupported_entry");
      const observed = now();
      return Object.freeze({
        source: Object.freeze({ node_ref: node.ref, relative_path: input.path }),
        observed_at: observed.toISOString(),
        freshness_seconds: Math.max(
          0,
          Math.min(86_400, Math.floor((observed.getTime() - metadata.mtimeMs) / 1000)),
        ),
        entry: Object.freeze({
          kind,
          size_bytes: Math.min(metadata.size, Number.MAX_SAFE_INTEGER),
          modified_at: metadata.mtime.toISOString(),
        }),
      });
    },
  });
}
