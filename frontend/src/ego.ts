// 확장형 스코핑 (M8) — flat 덤프 금지. 포커스 + 이웃만 보이고 클릭으로 확장.
// 화면에 ~MAX_VISIBLE 이하 유지, 나머지 on-demand (Neo4j Browser 방식).
import type { GraphData } from "./api";
import type { Pos } from "./layout";

export interface EgoView {
  data: GraphData;
  visible: number;
  total: number;
  truncated: boolean; // cap 으로 일부 이웃 생략됨
}

function adjacency(g: GraphData): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!adj.has(a)) adj.set(a, new Set());
    adj.get(a)!.add(b);
  };
  for (const r of g.rels) { link(r.from, r.to); link(r.to, r.from); }
  return adj;
}

// 포커스 + 확장된 노드들의 이웃을 cap 까지 노출.
export function egoView(
  full: GraphData, focusId: string, expanded: Set<string>, maxVisible = 50,
): EgoView {
  const adj = adjacency(full);
  const visible = new Set<string>([focusId, ...expanded]); // 포커스 + 확장된 노드 자체
  let truncated = false;
  for (const n of [focusId, ...expanded]) {
    for (const nb of adj.get(n) ?? []) {
      if (visible.has(nb)) continue;
      if (visible.size >= maxVisible) { truncated = true; break; }
      visible.add(nb);
    }
  }
  const nodes = full.nodes.filter((n) => visible.has(n.id));
  const rels = full.rels.filter((r) => visible.has(r.from) && visible.has(r.to));
  return { data: { nodes, rels }, visible: visible.size, total: full.nodes.length, truncated };
}

// 포커스 중심 방사형(결정적) — hop 거리별 동심원. ego 뷰 전용 레이아웃.
export function computeEgoLayout(g: GraphData, focusId: string): Pos[] {
  const adj = adjacency(g);
  const present = new Set(g.nodes.map((n) => n.id));
  const dist = new Map<string, number>([[focusId, 0]]);
  const queue = [focusId];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const nb of adj.get(cur) ?? []) {
      if (present.has(nb) && !dist.has(nb)) {
        dist.set(nb, (dist.get(cur) ?? 0) + 1);
        queue.push(nb);
      }
    }
  }
  // hop 별 그룹
  const rings = new Map<number, string[]>();
  let maxHop = 0;
  for (const n of g.nodes) {
    const d = dist.get(n.id) ?? 99; // 미연결(이론상 없음) → 바깥
    (rings.get(d) ?? rings.set(d, []).get(d)!).push(n.id);
    maxHop = Math.max(maxHop, d === 99 ? maxHop : d);
  }
  const R = 180;
  const pos = new Map<string, Pos>();
  for (const [hop, ids] of rings) {
    if (hop === 0) { pos.set(ids[0], { id: ids[0], x: 0, y: 0 }); continue; }
    const radius = R * hop;
    ids.forEach((id, i) => {
      const a = (2 * Math.PI * i) / ids.length;
      pos.set(id, { id, x: Math.cos(a) * radius, y: Math.sin(a) * radius });
    });
  }
  return g.nodes.map((n) => pos.get(n.id) ?? { id: n.id, x: 0, y: 0 });
}
