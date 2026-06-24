// 카테고리/상태 시각 규칙 (§화면2) — 한 곳에서 관리해 NVL/패널이 공유.
import type { GraphNode, GraphRel } from "./api";

// 알려진 라벨의 고정 색(나머지는 해시로 자동 배정). open vocabulary 라서
// 사내 스키마가 어떤 category 를 보내든 색이 결정된다(코드 수정 불필요).
export const CATEGORY_COLOR: Record<string, string> = {
  Process: "#2563eb", // 파랑
  Unit: "#059669", // 초록
  Property: "#d97706", // 주황
  FailureMode: "#dc2626", // 빨강 (이벤트 층, M12)
  Defect: "#dc2626", // 빨강 (불량 — 사내 라벨)
  Cause: "#7c3aed", // 보라 (이벤트 층, M12)
};

// 모르는 라벨 → 이름 해시로 결정적 색 배정(HSL). 회색 단색 대신 구분 가능하게.
function hashColor(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `hsl(${((h % 360) + 360) % 360}, 55%, 45%)`;
}

export function categoryColor(category: string): string {
  return CATEGORY_COLOR[category] ?? hashColor(category || "?");
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
      : n.category === "FailureMode" || n.category === "Defect" ? 24
      : n.category === "Cause" ? 22 : 20,
    selected: n.id === selectedId,
  };
}

// 백엔드 그래프 엣지 → NVL 관계
export function toNvlRel(r: GraphRel) {
  const style = REL_STYLE[(r.relation || "").toLowerCase()] ?? { width: 1.5, dashed: false };
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
