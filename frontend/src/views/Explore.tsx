// 화면2 — Explore (읽기 전용) · 3-pane.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchGraph } from "../api";
import type { GraphData } from "../api";
import GraphCanvas from "../components/GraphCanvas";
import NodePanel from "../components/NodePanel";
import LeftPanel from "../components/LeftPanel";
import type { Filters } from "../components/LeftPanel";

export default function Explore() {
  const [scope, setScope] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>({
    categories: new Set(["Process", "Unit", "Property"]),
    statuses: new Set(["confirmed", "proposed"]),
  });

  const fullGraph = useQuery({ queryKey: ["graph", null], queryFn: () => fetchGraph(null) });
  const scopedGraph = useQuery({
    queryKey: ["graph", scope],
    queryFn: () => fetchGraph(scope),
  });

  // 클라이언트 필터: 카테고리/status 로 노드 제거 + 매달린 엣지 제거
  const filtered: GraphData | undefined = useMemo(() => {
    const g = scopedGraph.data;
    if (!g) return undefined;
    const keep = new Set(
      g.nodes
        .filter((n) => filters.categories.has(n.category) && filters.statuses.has(n.status))
        .map((n) => n.id),
    );
    return {
      nodes: g.nodes.filter((n) => keep.has(n.id)),
      rels: g.rels.filter((r) => keep.has(r.from) && keep.has(r.to)),
    };
  }, [scopedGraph.data, filters]);

  return (
    <div className="three-pane">
      <aside className="pane-left">
        <LeftPanel
          full={fullGraph.data}
          scope={scope}
          onScope={setScope}
          filters={filters}
          onFilters={setFilters}
          onSelect={setSelected}
        />
      </aside>

      <main className="pane-center">
        {scopedGraph.isLoading && <div className="center-msg">그래프 로딩…</div>}
        {scopedGraph.isError && (
          <div className="center-msg error">
            백엔드 연결 실패 — uvicorn(8077)이 떠 있는지 확인하세요.
          </div>
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
      <span className="muted">흐림=proposed · 진함=confirmed</span>
    </div>
  );
}
