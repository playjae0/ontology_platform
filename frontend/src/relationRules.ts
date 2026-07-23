// 관계(엣지) 유효성 규칙 — 백엔드 _category_warning(mutations.py)과 동일 기준.
// UI 에서 "가능한 관계/노드만" 선택되게 제약해 무효 엣지(예: Unit→precedes) 생성을 사전 차단.
// (백엔드는 여전히 경고만; 프론트가 애초에 무효 조합을 안 만들게 한다.)

export const REL_RULES: Record<string, { src: string[]; tgt: string[] }> = {
  part_of: { src: ["Unit", "Process"], tgt: ["Process"] },
  precedes: { src: ["Process"], tgt: ["Process"] },
  has_property: { src: ["Unit", "Process"], tgt: ["Property"] },
  causes: { src: ["Cause"], tgt: ["FailureMode"] },
  affects: { src: ["FailureMode", "Cause"], tgt: ["Property", "Unit", "Process"] },
};

export const ALL_RELATIONS = Object.keys(REL_RULES);

// 이 카테고리가 source 일 때 만들 수 있는 관계들
export function relationsForSource(srcCat?: string): string[] {
  if (!srcCat) return ALL_RELATIONS;
  return ALL_RELATIONS.filter((r) => REL_RULES[r].src.includes(srcCat));
}

// (source,target) 카테고리 쌍에 유효한 관계들 (엣지 타입 변경용)
export function relationsForPair(srcCat?: string, tgtCat?: string): string[] {
  return ALL_RELATIONS.filter(
    (r) =>
      (!srcCat || REL_RULES[r].src.includes(srcCat)) &&
      (!tgtCat || REL_RULES[r].tgt.includes(tgtCat)),
  );
}

// 관계의 유효 target 카테고리 / 유효 source 카테고리
export function targetCatsFor(rel: string): string[] {
  return REL_RULES[rel]?.tgt ?? [];
}
export function sourceCatsFor(rel: string): string[] {
  return REL_RULES[rel]?.src ?? [];
}
