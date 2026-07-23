// 그래프 위 컴팩트 필터 바 (Neo4j 브라우저식) — 노드 카테고리 / 관계 타입 on·off 칩.
// Workbench 좌측 그래프 상단에 배치. 읽기 전용 표시 필터(§6 무변경).
import { ALL_CATEGORIES, ALL_RELATIONS, toggleIn } from "../graphFilters";
import type { GraphFilters } from "../graphFilters";
import { categoryColor } from "../theme";

interface Props {
  filters: GraphFilters;
  onChange: (f: GraphFilters) => void;
}

export default function GraphFilterBar({ filters, onChange }: Props) {
  return (
    <div className="graph-filter-bar">
      <div className="gfb-group">
        <span className="gfb-label">노드</span>
        {ALL_CATEGORIES.map((c) => (
          <label key={c} className={`gfb-chip ${filters.categories.has(c) ? "on" : "off"}`}>
            <input
              type="checkbox"
              checked={filters.categories.has(c)}
              onChange={() => onChange({ ...filters, categories: toggleIn(filters.categories, c) })}
            />
            <span className="gfb-dot" style={{ background: categoryColor(c) }} />
            {c}
          </label>
        ))}
      </div>
      <div className="gfb-group">
        <span className="gfb-label">관계</span>
        {ALL_RELATIONS.map((r) => (
          <label key={r} className={`gfb-chip ${filters.relations.has(r) ? "on" : "off"}`}>
            <input
              type="checkbox"
              checked={filters.relations.has(r)}
              onChange={() => onChange({ ...filters, relations: toggleIn(filters.relations, r) })}
            />
            <span className="gfb-line" />
            {r}
          </label>
        ))}
      </div>
    </div>
  );
}
