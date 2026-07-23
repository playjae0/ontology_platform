// 그래프 시각화 필터 (Neo4j 브라우저식 — 노드 카테고리 / 관계 타입 on·off).
// 읽기 전용·클라이언트 표시 필터일 뿐 — SSOT/백엔드 무변경(§6). Explore·Workbench 공유.
import type { GraphData } from "./api";

export const ALL_CATEGORIES = ["Process", "Unit", "Property", "FailureMode", "Cause"];
export const ALL_RELATIONS = ["part_of", "precedes", "has_property", "causes", "affects"];

export interface GraphFilters {
  categories: Set<string>;
  relations: Set<string>;
  statuses: Set<string>;
}

export function defaultFilters(): GraphFilters {
  return {
    categories: new Set(ALL_CATEGORIES),
    relations: new Set(ALL_RELATIONS),
    statuses: new Set(["confirmed", "proposed"]),
  };
}

export function toggleIn(set: Set<string>, v: string): Set<string> {
  const next = new Set(set);
  next.has(v) ? next.delete(v) : next.add(v);
  return next;
}

// 노드는 카테고리+status 로, 엣지는 관계타입 + (양 끝 노드 생존) 으로 걸러낸다.
// → 특정 관계(예: part_of)만 꺼서 화면에서 감출 수 있다(Neo4j relationship-type 토글과 동일).
export function applyGraphFilters(g: GraphData, f: GraphFilters): GraphData {
  const keep = new Set(
    g.nodes
      .filter((n) => f.categories.has(n.category) && f.statuses.has(n.status))
      .map((n) => n.id),
  );
  return {
    nodes: g.nodes.filter((n) => keep.has(n.id)),
    rels: g.rels.filter(
      (r) => keep.has(r.from) && keep.has(r.to) && f.relations.has(r.relation),
    ),
  };
}
