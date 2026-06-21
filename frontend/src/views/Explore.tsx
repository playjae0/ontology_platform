// 화면2 — Explore (읽기 전용) · 3-pane. 렌더-at-scale(M8): 확장형 스코핑 + 레이아웃 분기 + WebGL config.
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchGraph } from "../api";
import type { GraphData } from "../api";
import GraphCanvas from "../components/GraphCanvas";
import NodePanel from "../components/NodePanel";
import LeftPanel from "../components/LeftPanel";
import type { Filters } from "../components/LeftPanel";
import { useBackend } from "../backend";
import { egoView, computeEgoLayout } from "../ego";

// 렌더-at-scale 임계 (§3.5/M8)
const EGO_THRESHOLD = 60;   // 초과 시 확장형 스코핑(flat 덤프 금지)
const MAX_VISIBLE = 50;     // 화면에 한 번에 유지할 상한
const FORCE_THRESHOLD = 60; // flat 보기에서 초과 시 NVL force 워커
const WEBGL_THRESHOLD = 300; // 초과 시 WebGL 권장(config)

export default function Explore() {
  const { backend, recordMs } = useBackend();
  const [scope, setScope] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>({
    categories: new Set(["Process", "Unit", "Property", "FailureMode", "Cause"]),
    statuses: new Set(["confirmed", "proposed"]),
  });
  // 확장형 스코핑 상태
  const [flatView, setFlatView] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [webglOverride, setWebglOverride] = useState<boolean | null>(null);

  const fullGraph = useQuery({
    queryKey: ["graph", null, backend],
    queryFn: () => fetchGraph(null, backend),
  });
  const scopedGraph = useQuery({
    queryKey: ["graph", scope, backend],
    queryFn: async () => {
      const t = performance.now();
      const d = await fetchGraph(scope, backend);
      recordMs(backend, performance.now() - t);
      return d;
    },
  });

  // 스코프 바뀌면 확장 상태 초기화 (포커스 = 스코프 노드 또는 첫 노드)
  useEffect(() => {
    setExpanded(new Set());
    setFlatView(false);
    setFocus(scope ?? scopedGraph.data?.nodes[0]?.id ?? null);
  }, [scope, scopedGraph.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // 카테고리/status 필터 적용
  const filtered: GraphData | undefined = useMemo(() => {
    const g = scopedGraph.data;
    if (!g) return undefined;
    const keep = new Set(
      g.nodes.filter((n) => filters.categories.has(n.category) && filters.statuses.has(n.status)).map((n) => n.id),
    );
    return { nodes: g.nodes.filter((n) => keep.has(n.id)), rels: g.rels.filter((r) => keep.has(r.from) && keep.has(r.to)) };
  }, [scopedGraph.data, filters]);

  const total = filtered?.nodes.length ?? 0;
  const large = total > EGO_THRESHOLD;
  const egoMode = large && !flatView;

  // 렌더 데이터/좌표/레이아웃 분기
  const view = useMemo(() => {
    if (!filtered) return null;
    if (egoMode && focus) {
      const ev = egoView(filtered, focus, expanded, MAX_VISIBLE);
      return { data: ev.data, positions: computeEgoLayout(ev.data, focus), layoutMode: "deterministic" as const, ego: ev };
    }
    // flat: 소규모=결정적 계층, 수백=force 워커
    const layoutMode = filtered.nodes.length > FORCE_THRESHOLD ? "force" as const : "deterministic" as const;
    return { data: filtered, positions: undefined, layoutMode, ego: null };
  }, [filtered, egoMode, focus, expanded]);

  const renderCount = view?.data.nodes.length ?? 0;
  const webgl = webglOverride ?? renderCount > WEBGL_THRESHOLD;

  // 노드 클릭: 상세 + (ego 모드) 이웃 확장
  const onSelect = (id: string) => {
    setSelected(id);
    if (egoMode) setExpanded((s) => new Set(s).add(id));
  };

  return (
    <div className="three-pane">
      <aside className="pane-left">
        <LeftPanel full={fullGraph.data} scope={scope} onScope={setScope}
          filters={filters} onFilters={setFilters} onSelect={onSelect} />
      </aside>

      <main className="pane-center">
        {scopedGraph.isLoading && <div className="center-msg">그래프 로딩…</div>}
        {scopedGraph.isError && (
          <div className="center-msg error">백엔드 연결 실패 — uvicorn(8077) 확인.</div>
        )}
        {view && view.data.nodes.length === 0 && <div className="center-msg">필터에 맞는 노드가 없습니다.</div>}
        {view && view.data.nodes.length > 0 && (
          <GraphCanvas data={view.data} positions={view.positions} layoutMode={view.layoutMode}
            webgl={webgl} selectedId={selected} onSelect={onSelect} />
        )}

        {large && (
          <div className="scale-bar">
            {egoMode ? (
              <>
                <span className="scale-tag">확장형 보기</span>
                <span className="muted">
                  {view?.ego?.visible}/{total} 노드 (포커스 <b>{focusName(filtered, focus)}</b> · 클릭으로 이웃 확장)
                  {view?.ego?.truncated && " · 이웃 일부 생략(상한)"}
                </span>
                <button onClick={() => setExpanded(new Set())}>접기</button>
                <button onClick={() => setFlatView(true)}>전체 평면 보기</button>
              </>
            ) : (
              <>
                <span className="scale-tag flat">전체 평면 ({total}노드)</span>
                <span className="muted">레이아웃: {view?.layoutMode}</span>
                <button onClick={() => setFlatView(false)}>확장형으로</button>
              </>
            )}
            <span className="scale-render">
              렌더러: {webgl ? "WebGL" : "Canvas"}
              <button className="webgl-toggle" onClick={() => setWebglOverride(!webgl)}>
                {webgl ? "Canvas 로" : "WebGL 로"}
              </button>
            </span>
          </div>
        )}
        <Legend />
      </main>

      <aside className="pane-right">
        <NodePanel nodeId={selected} />
      </aside>
    </div>
  );
}

function focusName(g: GraphData | undefined, id: string | null): string {
  if (!g || !id) return id ?? "-";
  return g.nodes.find((n) => n.id === id)?.caption ?? id;
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
