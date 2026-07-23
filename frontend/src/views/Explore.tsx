// 화면2 — Explore (읽기 전용) · 3-pane.
// 렌더링은 검수 Workbench 와 동일한 단순·결정적 방식(GraphCanvas deterministic)으로 통일.
// (M8 확장형 스코핑/force/WebGL 분기는 mock 규모에서 과했고 불안정 → 제거. 필요 시 스케일 fixture 전용으로 재도입.)
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchGraph } from "../api";
import type { GraphData } from "../api";
import GraphCanvas from "../components/GraphCanvas";
import NodePanel from "../components/NodePanel";
import LeftPanel from "../components/LeftPanel";
import type { Filters } from "../components/LeftPanel";
import { applyGraphFilters, defaultFilters } from "../graphFilters";
import { useBackend } from "../backend";

export default function Explore({ focusNode }: { focusNode?: string | null }) {
  const { backend, recordMs } = useBackend();
  const [selected, setSelected] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(defaultFilters());

  const graph = useQuery({
    queryKey: ["graph", null, backend],
    queryFn: async () => {
      const t = performance.now();
      const d = await fetchGraph(null, backend);
      recordMs(backend, performance.now() - t);
      return d;
    },
  });

  // 문서관리 등에서 노드 점프 시 우측 상세에 표시
  useEffect(() => {
    if (focusNode) setSelected(focusNode);
  }, [focusNode]);

  // 카테고리(노드)/관계(엣지)/status 필터 적용
  const filtered: GraphData | undefined = useMemo(
    () => (graph.data ? applyGraphFilters(graph.data, filters) : undefined),
    [graph.data, filters],
  );

  return (
    <div className="three-pane">
      <aside className="pane-left">
        <LeftPanel
          full={graph.data}
          filters={filters}
          onFilters={setFilters}
          onSelect={setSelected}
        />
      </aside>

      <main className="pane-center">
        {graph.isLoading && <div className="center-msg">그래프 로딩…</div>}
        {graph.isError && (
          <div className="center-msg error">백엔드 연결 실패 — uvicorn(8077) 확인.</div>
        )}
        {filtered && filtered.nodes.length === 0 && (
          <div className="center-msg">필터에 맞는 노드가 없습니다.</div>
        )}
        {filtered && filtered.nodes.length > 0 && (
          <GraphCanvas data={filtered} selectedId={selected} onSelect={setSelected} />
        )}
        <Legend />
      </main>

      <aside className="pane-right">
        <NodePanel nodeId={selected} />
      </aside>
    </div>
  );
}

function Legend() {
  return (
    <div className="legend">
      <span><i className="lg" style={{ background: "#2563eb" }} />Process</span>
      <span><i className="lg" style={{ background: "#059669" }} />Unit</span>
      <span><i className="lg" style={{ background: "#d97706" }} />Property</span>
      <span><i className="lg" style={{ background: "#dc2626" }} />FailureMode</span>
      <span><i className="lg" style={{ background: "#7c3aed" }} />Cause</span>
      <span className="muted">흐림=proposed · 진함=confirmed</span>
    </div>
  );
}
