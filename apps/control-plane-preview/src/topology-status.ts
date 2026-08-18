export type TopologyStatus = {
  readonly schema: "yukh-control-plane-topology-status-v1";
  readonly generated_at: string;
  readonly source: "static-preview";
  readonly runtimes: readonly TopologyRuntime[];
};

export type TopologyRuntime = {
  readonly id: "projects" | "orchestration" | "coordination" | "jetstream";
  readonly name: string;
  readonly owner: string;
  readonly state: "ready_for_handoff" | "preview" | "local_preview" | "shared_service";
  readonly writes: string;
  readonly rule: string;
};

const runtimes: readonly TopologyRuntime[] = [
  {
    id: "projects",
    name: "Projects governance",
    owner: "yukh-projects",
    state: "ready_for_handoff",
    writes: "YKP_WORK_EVENTS_V1 and rebuildable KV projections",
    rule: "Admits claims, leases, budgets, roadmap and result evidence.",
  },
  {
    id: "orchestration",
    name: "Orchestration",
    owner: "yukh-mcp / Control Plane",
    state: "preview",
    writes: "team state, action receipts and worker lifecycle",
    rule: "Consumes Projects handoffs and starts bounded managers or workers.",
  },
  {
    id: "coordination",
    name: "Agent communication",
    owner: "yukh-coordination",
    state: "local_preview",
    writes: "Coordination transcript and receipt store",
    rule: "Carries join, ask, answer and replay. A message is evidence, not work authority.",
  },
  {
    id: "jetstream",
    name: "JetStream runtime",
    owner: "NATS",
    state: "shared_service",
    writes: "separate stream and bucket namespaces",
    rule: "May be one physical runtime, never one shared logical contract.",
  },
];

export function createTopologyStatus(now = new Date()): TopologyStatus {
  return {
    schema: "yukh-control-plane-topology-status-v1",
    generated_at: now.toISOString(),
    source: "static-preview",
    runtimes,
  };
}
