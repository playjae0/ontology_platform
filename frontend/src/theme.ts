// 카테고리/상태 시각 규칙 (§화면2) — 한 곳에서 관리해 NVL/패널이 공유.
import type { GraphNode, GraphRel } from "./api";

// 파스텔 톤 — 채도를 낮춰 부드럽게. 카테고리 구분은 유지(색상 계열 동일).
export const CATEGORY_COLOR: Record<string, string> = {
  Process: "#8fb3e6", // 연한 파랑
  Unit: "#86cbb0", // 연한 민트
  Property: "#f0c48a", // 연한 살구
  FailureMode: "#ec9d9d", // 연한 로즈 (이벤트 층, M12)
  Cause: "#b9a7e4", // 연한 라벤더 (이벤트 층, M12)
};
const DEFAULT_COLOR = "#b8bec7";

export function categoryColor(category: string): string {
  return CATEGORY_COLOR[category] ?? DEFAULT_COLOR;
}

// proposed 는 흐리게, confirmed 는 진하게
function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255).toString(16).padStart(2, "0");
  return `${hex}${a}`;
}

const REL_STYLE: Record<string, { width: number; dashed: boolean }> = {
  part_of: { width: 3, dashed: false }, // 계층
  precedes: { width: 2, dashed: false }, // 순서
  has_property: { width: 1.5, dashed: true }, // 부착
  causes: { width: 2, dashed: false }, // 이벤트: 원인→불량 (M12)
  affects: { width: 1.5, dashed: true }, // 이벤트: 불량→영향 (M12)
};

// 백엔드 그래프 노드 → NVL 노드
export function toNvlNode(n: GraphNode, selectedId: string | null) {
  const base = categoryColor(n.category);
  const confirmed = n.status === "confirmed";
  return {
    id: n.id,
    caption: n.caption,
    color: confirmed ? base : withAlpha(base, 0.4),
    size: n.category === "Process" ? 34 : n.category === "Unit" ? 26
      : n.category === "FailureMode" ? 24 : n.category === "Cause" ? 22 : 20,
    selected: n.id === selectedId,
  };
}

// 백엔드 그래프 엣지 → NVL 관계
export function toNvlRel(r: GraphRel) {
  const style = REL_STYLE[r.relation] ?? { width: 1.5, dashed: false };
  const confirmed = r.status === "confirmed";
  return {
    id: r.id,
    from: r.from,
    to: r.to,
    caption: r.caption,
    width: style.width,
    color: confirmed ? "#475569" : "#cbd5e1",
  };
}
