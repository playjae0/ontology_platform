// 결정적 계층 레이아웃 (§화면2: part_of 계층 / precedes 순서 / has_property 부착).
// NVL 레이아웃 워커에 의존하지 않고 클라이언트에서 좌표를 직접 산출 → 작은 backbone에
// 안정적이고 재현 가능한 트리 배치를 보장한다.
import type { GraphData } from "./api";

export interface Pos {
  id: string;
  x: number;
  y: number;
}

const Y_GAP = 150; // 깊이(계층) 간격
const X_GAP = 130; // 형제 간격

export function computeLayout(data: GraphData): Pos[] {
  const ids = new Set(data.nodes.map((n) => n.id));

  // 부모→자식: part_of(child→parent) 역방향, has_property(unit→property) 정방향
  const parentOf = new Map<string, string>();
  const childrenOf = new Map<string, string[]>();
  const add = (parent: string, child: string) => {
    if (!ids.has(parent) || !ids.has(child)) return;
    parentOf.set(child, parent);
    (childrenOf.get(parent) ?? childrenOf.set(parent, []).get(parent)!).push(child);
  };
  for (const r of data.rels) {
    if (r.relation === "part_of") add(r.to, r.from);
    else if (r.relation === "has_property") add(r.from, r.to);
  }

  // precedes 순서로 형제 정렬 (해당되는 경우)
  const precNext = new Map<string, string>();
  for (const r of data.rels) if (r.relation === "precedes") precNext.set(r.from, r.to);
  const orderSiblings = (sibs: string[]): string[] => {
    const set = new Set(sibs);
    const hasIncoming = new Set<string>();
    for (const s of sibs) {
      const nx = precNext.get(s);
      if (nx && set.has(nx)) hasIncoming.add(nx);
    }
    const starts = sibs.filter((s) => !hasIncoming.has(s));
    const seen = new Set<string>();
    const out: string[] = [];
    for (const s of starts) {
      let cur: string | undefined = s;
      while (cur && set.has(cur) && !seen.has(cur)) {
        seen.add(cur);
        out.push(cur);
        cur = precNext.get(cur);
      }
    }
    for (const s of sibs) if (!seen.has(s)) out.push(s); // precedes 없는 나머지
    return out;
  };

  const roots = orderSiblings(data.nodes.map((n) => n.id).filter((id) => !parentOf.has(id)));

  // 리프에 x 슬롯 부여(in-order DFS) → 내부 노드 x = 자식 평균. y = 깊이.
  const pos = new Map<string, Pos>();
  let slot = 0;
  const dfs = (id: string, depth: number): number => {
    const kids = orderSiblings(childrenOf.get(id) ?? []);
    let x: number;
    if (kids.length === 0) {
      x = slot++ * X_GAP;
    } else {
      const xs = kids.map((k) => dfs(k, depth + 1));
      x = (xs[0] + xs[xs.length - 1]) / 2;
    }
    pos.set(id, { id, x, y: depth * Y_GAP });
    return x;
  };
  roots.forEach((r) => dfs(r, 0));

  return data.nodes.map((n) => pos.get(n.id) ?? { id: n.id, x: 0, y: 0 });
}
