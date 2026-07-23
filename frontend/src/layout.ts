// 결정적 계층 레이아웃 (§화면2: part_of 계층 / precedes 순서 / has_property 부착).
// NVL 레이아웃 워커에 의존하지 않고 클라이언트에서 좌표를 직접 산출 → 작은 backbone에
// 안정적이고 재현 가능한 트리 배치를 보장한다.
import type { GraphData } from "./api";

export interface Pos {
  id: string;
  x: number;
  y: number;
}

const Y_GAP = 280; // 깊이(계층) 간격 — 상·하위 노드를 세로로 더 멀리
const X_GAP = 155; // 리프 1칸 폭(px)

// 형제 서브트리 사이 추가 간격(리프 단위). 얕을수록(상위=공정) 크게 → 공정끼리 멀리.
const SIB_GAP: Record<number, number> = { 1: 7, 2: 2.2, 3: 1.0 };
const gapAt = (depth: number) => SIB_GAP[depth] ?? 0.7;
// 밀집도 가중: 서브트리 리프 수가 많을수록 이웃과 더 벌어진다.
const SIZE_W = 0.14;

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

  // 서브트리 리프 수(밀집도) — 큰 서브트리는 이웃과 더 벌린다.
  const leafCount = new Map<string, number>();
  const countLeaves = (id: string): number => {
    const kids = childrenOf.get(id) ?? [];
    const c = kids.length === 0 ? 1 : kids.reduce((s, k) => s + countLeaves(k), 0);
    leafCount.set(id, c);
    return c;
  };
  roots.forEach(countLeaves);

  // in-order DFS: 리프는 커서를 전진시키며 좌표 획득(형제 사이 간격 삽입),
  // 내부 노드 x = 자식들의 중앙. y = 깊이. 좌표는 리프-단위 → 마지막에 X_GAP 로 스케일.
  const pos = new Map<string, Pos>();
  let cursor = 0;
  const dfs = (id: string, depth: number): number => {
    const kids = orderSiblings(childrenOf.get(id) ?? []);
    let x: number;
    if (kids.length === 0) {
      x = cursor;
      cursor += 1; // 리프 1칸
    } else {
      const xs: number[] = [];
      kids.forEach((k, i) => {
        if (i > 0) {
          // 형제 간격 = 깊이 가중 + 양쪽 서브트리 크기 가중(밀집한 것끼리 더 멀리)
          const sizeW = SIZE_W * ((leafCount.get(kids[i - 1]) ?? 1) + (leafCount.get(k) ?? 1));
          cursor += gapAt(depth + 1) + sizeW;
        }
        xs.push(dfs(k, depth + 1));
      });
      x = (xs[0] + xs[xs.length - 1]) / 2;
    }
    pos.set(id, { id, x: x * X_GAP, y: depth * Y_GAP });
    return x;
  };
  roots.forEach((r, i) => {
    if (i > 0) cursor += gapAt(1); // 분리된 트리(조립공정 vs 이벤트 노드) 사이 큰 간격
    dfs(r, 0);
  });

  return data.nodes.map((n) => pos.get(n.id) ?? { id: n.id, x: 0, y: 0 });
}
