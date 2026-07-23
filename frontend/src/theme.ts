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

// 연결선 굵기는 모든 관계 동일(얇게). 관계 구분은 엣지 캡션(라벨)으로.
const REL_WIDTH = 1;

// 백엔드 그래프 노드 → NVL 노드
export function toNvlNode(n: GraphNode, selectedId: string | null) {
  const base = categoryColor(n.category);
  const confirmed = n.status === "confirmed";
  return {
    id: n.id,
    caption: n.caption,
    color: confirmed ? base : withAlpha(base, 0.4),
    // NVL 노드 캡션은 원 '안'에만 그려지고 글자가 원보다 넓으면 숨는다. 작은 노드
    // (Property/Cause)의 긴 한글 이름이 잘리는 걸 줄이려 최소 크기를 키움(원 안 여유).
    // 전체 이름은 노드 클릭 시 우측 상세 패널에 항상 표시(§3.5 캔버스는 라벨 보조).
    size: n.category === "Process" ? 40 : n.category === "Unit" ? 34
      : n.category === "FailureMode" ? 32 : n.category === "Cause" ? 32 : 30,
    selected: n.id === selectedId,
  };
}

// 백엔드 그래프 엣지 → NVL 관계
export function toNvlRel(r: GraphRel) {
  const confirmed = r.status === "confirmed";
  return {
    id: r.id,
    from: r.from,
    to: r.to,
    caption: r.caption,
    width: REL_WIDTH,
    color: confirmed ? "#475569" : "#cbd5e1",
  };
}
