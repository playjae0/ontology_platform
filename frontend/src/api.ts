// API 레이어 — 백엔드 읽기 엔드포인트 (§5 R)
// 백엔드는 GraphReader 만 노출하므로 JSON↔Neo4j 전환 시 프론트는 불변.

export const API_BASE =
  import.meta.env.VITE_API_BASE ?? "http://localhost:8077";

export type Category = "Process" | "Unit" | "Property";
export type Status = "proposed" | "confirmed";

export interface GraphNode {
  id: string;
  caption: string;
  category: Category | string;
  status: Status | string;
}

export interface GraphRel {
  id: string;
  from: string;
  to: string;
  caption: string;
  relation: string;
  status: string;
}

export interface GraphData {
  nodes: GraphNode[];
  rels: GraphRel[];
}

export interface Adjacency {
  dir: "in" | "out";
  relation: string;
  other: string;
  other_name: string;
  status: string;
}

export interface NodeDetail {
  id: string;
  canonical_name: string;
  category: string;
  status: string;
  definition: string;
  spec: string | null;
  aliases: string[];
  attached_to: string | null;
  provenance: unknown[];
  adjacency: Adjacency[];
  // embedding 은 백엔드가 절대 내려주지 않는다 (§6.2)
}

export interface Chunk {
  cid: string;
  doc_id: string;
  section: string;
  text: string;
  meta?: Record<string, unknown>;
}

export interface SlotInfo {
  present: boolean;
  adopted_at: string | null;
}

export interface DataStatus {
  skeleton_loaded: boolean;
  contents_loaded: boolean;
  counts: { nodes: number; edges: number; chunks: number; describes: number };
  nodes_by_category: Record<string, number>;
  nodes_by_status: Record<string, number>;
  slots: Record<string, SlotInfo>;
  backups: number;
  can_rollback: boolean;
}

export type Slot = "chunks" | "skeleton" | "contents";

export interface ValidationError {
  path: string;
  msg: string;
}

export interface UploadResult {
  valid: boolean;
  errors: ValidationError[];
  adopted: boolean;
  counts?: Record<string, number>;
  ssot_errors?: ValidationError[];
  warning?: string;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} @ ${path}`);
  return res.json() as Promise<T>;
}

export interface DashboardStats {
  scale: {
    nodes: number; edges: number; chunks: number; describes: number;
    nodes_by_category: Record<string, number>;
    edges_by_relation: Record<string, number>;
  };
  status: Record<string, number>;
  coverage: { id: string; name: string; nodes: number; chunks: number }[];
  dictionary: { aliases_total: number };
  health: {
    unlinked_chunks: number; total_chunks: number; unlinked_chunk_rate: number;
    orphan_nodes: number; unit_property_total: number; orphan_node_rate: number;
  };
  review: { queue_by_kind: Record<string, number>; queue_total: number; orphans: number };
}
export const fetchDashboard = (backend: string = "json") =>
  get<DashboardStats>(`/dashboard/stats?backend=${backend}`);

export const fetchStatus = () => get<DataStatus>("/data/status");
export const fetchGraph = (scope?: string | null, backend: string = "json") =>
  get<GraphData>(
    `/graph?${scope ? `scope=${encodeURIComponent(scope)}&` : ""}backend=${backend}`);
export const fetchNode = (id: string) => get<NodeDetail>(`/nodes/${id}`);
export const fetchNodeChunks = (id: string) => get<Chunk[]>(`/nodes/${id}/chunks`);

export interface NodeSearchHit {
  id: string;
  canonical_name: string;
  category: string;
  aliases: string[];
}
export const searchNodes = (q: string, limit = 20) =>
  get<NodeSearchHit[]>(`/nodes/search?q=${encodeURIComponent(q)}&limit=${limit}`);

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText} @ ${path} ${txt}`);
  }
  return res.json() as Promise<T>;
}

// adopt=false: 검증만(dry-run) · adopt=true: 검증+채택(replace)
export const uploadSlot = (slot: Slot, data: unknown, adopt: boolean) =>
  post<UploadResult>(`/ingest/upload/${slot}?adopt=${adopt}`, data);

// ---- M4 스테이지 슬롯 ----
export type StageConfig = { parser: string; skeleton: string; content: string };
export const fetchStageConfig = () => get<StageConfig>("/stage/config");
export const runStage = (slot: string, input?: unknown) =>
  post(`/stage/run/${slot}`, input ?? {});
export const rollback = () => post<{ ok: boolean; msg?: string }>("/ingest/rollback");
export const resetMock = () => post<{ ok: boolean }>("/ingest/reset-mock");

// ---- M3 검수/승인/편집 ----
export interface ReviewItem {
  rid: string;
  kind: string;
  surface: string;
  category: string;
  attach_to: string | null;
  spec: string | null;
  reason: string;
  doc_id: string;
  evidence: Chunk[];
}

export interface OrphanNode {
  node_id: string;
  kind: string;
  surface: string;
  category: string;
}

export const fetchReviewQueue = () =>
  get<{ items: ReviewItem[]; orphans: OrphanNode[] }>("/review/queue");
export const approveReview = (rid: string, attach_to?: string | null) =>
  post("/review/approve", { rid, attach_to: attach_to ?? null });
export const approveBatch = (rids: string[]) => post("/review/approve-batch", { rids });
export const rejectReview = (rid: string) => post("/review/reject", { rid });
export const absorbReview = (rid: string, target: string) =>
  post("/review/absorb", { rid, target });

export interface NodeEdit {
  canonical_name?: string;
  definition?: string;
  spec?: string | null;
  status?: string;
}
export const editNode = (id: string, fields: NodeEdit) => post(`/nodes/${id}/edit`, fields);
export const aliasNode = (id: string, op: "add" | "remove", alias: string) =>
  post(`/nodes/${id}/alias`, { op, alias });

// ---- M5 엣지 편집 ----
export type EdgeOp = "add" | "delete" | "update";
export interface EdgeEdit {
  op: EdgeOp;
  source: string;
  relation: string;
  target: string;
  new_source?: string;
  new_relation?: string;
  new_target?: string;
}
export const editEdge = (body: EdgeEdit) =>
  post<{ ok: boolean; warning?: string | null }>("/edges/edit", body);

// ---- M7 백엔드 토글(진단) ----
export interface Neo4jStatus { active: boolean; uri: string }
export const fetchNeo4jStatus = () => get<Neo4jStatus>("/neo4j/status");
export const syncNeo4j = () =>
  post<{ ok: boolean; synced: Record<string, number>; sync_ms: number }>("/neo4j/sync");
