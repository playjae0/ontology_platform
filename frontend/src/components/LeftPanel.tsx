// 좌측 패널 (§화면2 좌): 공정 스코프 선택 + 카테고리/status 필터 + 동의어 검색.
import { useMemo, useState } from "react";
import type { GraphData } from "../api";
import { categoryColor } from "../theme";

export interface Filters {
  categories: Set<string>;
  statuses: Set<string>;
}

interface Props {
  full: GraphData | undefined; // 전체 그래프(스코프/검색 후보 산출용)
  scope: string | null;
  onScope: (id: string | null) => void;
  filters: Filters;
  onFilters: (f: Filters) => void;
  onSelect: (id: string) => void;
}

const ALL_CATS = ["Process", "Unit", "Property", "FailureMode", "Cause"];
const ALL_STATUS = ["confirmed", "proposed"];

export default function LeftPanel({
  full,
  scope,
  onScope,
  filters,
  onFilters,
  onSelect,
}: Props) {
  const [q, setQ] = useState("");

  const processes = useMemo(
    () => (full?.nodes ?? []).filter((n) => n.category === "Process"),
    [full],
  );

  // 동의어/이름 검색: caption(=canonical_name) 매칭. alias 는 노드 상세에 있으나
  // 그래프 노드 캡션 기준 간이 검색(§6.6: 검색이 alias를 누적하지 않음 — 읽기만).
  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    return (full?.nodes ?? [])
      .filter((n) => n.caption.toLowerCase().includes(t) || n.id.toLowerCase().includes(t))
      .slice(0, 12);
  }, [q, full]);

  function toggle(set: Set<string>, v: string): Set<string> {
    const next = new Set(set);
    next.has(v) ? next.delete(v) : next.add(v);
    return next;
  }

  return (
    <div className="left-panel">
      <section>
        <h3>공정 스코프</h3>
        <button
          className={`scope-btn ${scope === null ? "active" : ""}`}
          onClick={() => onScope(null)}
        >
          전체 보기
        </button>
        {processes.map((p) => (
          <button
            key={p.id}
            className={`scope-btn ${scope === p.id ? "active" : ""}`}
            onClick={() => onScope(p.id)}
          >
            {p.caption}
          </button>
        ))}
      </section>

      <section>
        <h3>카테고리</h3>
        {ALL_CATS.map((c) => (
          <label key={c} className="filter-row">
            <input
              type="checkbox"
              checked={filters.categories.has(c)}
              onChange={() =>
                onFilters({ ...filters, categories: toggle(filters.categories, c) })
              }
            />
            <span className="cat-dot" style={{ background: categoryColor(c) }} />
            {c}
          </label>
        ))}
      </section>

      <section>
        <h3>상태</h3>
        {ALL_STATUS.map((s) => (
          <label key={s} className="filter-row">
            <input
              type="checkbox"
              checked={filters.statuses.has(s)}
              onChange={() =>
                onFilters({ ...filters, statuses: toggle(filters.statuses, s) })
              }
            />
            {s}
          </label>
        ))}
      </section>

      <section>
        <h3>검색 (이름/동의어)</h3>
        <input
          className="search-input"
          placeholder="노칭, notching…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {matches.map((m) => (
          <button key={m.id} className="search-hit" onClick={() => onSelect(m.id)}>
            {m.caption} <span className="muted">{m.id}</span>
          </button>
        ))}
      </section>
    </div>
  );
}
