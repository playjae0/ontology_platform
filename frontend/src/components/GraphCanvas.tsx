// 중앙 NVL 캔버스 (§화면2 중앙). 읽기 전용.
// ⚠️ disableTelemetry: true 필수 (§3.5 — 외부 전송 금지).
// 렌더-at-scale(M8): 레이아웃 분기 + WebGL config.
//  - layoutMode="deterministic": 클라이언트 좌표(layout.ts / 부모 positions) 주입(워커 비의존).
//  - layoutMode="force": NVL forceDirected 워커(대규모 분기).
//  - webgl: 노드 임계 초과 시 WebGL(헤드리스는 Canvas 유지).
import { useEffect, useMemo, useRef } from "react";
import type NVL from "@neo4j-nvl/base";
import { InteractiveNvlWrapper } from "@neo4j-nvl/react";
import type { GraphData } from "../api";
import type { Pos } from "../layout";
import { toNvlNode, toNvlRel } from "../theme";
import { computeLayout } from "../layout";

interface Props {
  data: GraphData;
  selectedId: string | null;
  onSelect: (id: string) => void;
  layoutMode?: "deterministic" | "force";
  positions?: Pos[]; // deterministic 일 때 부모가 좌표 주입(ego 등). 없으면 computeLayout.
  webgl?: boolean;
  spread?: number; // 좌표 스케일(>1 이면 더 멀리 벌린다). 기본 1.
}

export default function GraphCanvas({
  data, selectedId, onSelect, layoutMode = "deterministic", positions, webgl = false, spread = 1,
}: Props) {
  const nvlRef = useRef<NVL | null>(null);
  const det = layoutMode === "deterministic";

  const pos = useMemo(() => {
    if (!det) return [];
    const base = positions ?? computeLayout(data);
    return spread === 1 ? base : base.map((p) => ({ ...p, x: p.x * spread, y: p.y * spread }));
  }, [det, positions, data, spread]);

  // 좌표는 노드 객체에 싣지 않고 positions prop 으로만 주입한다. 이렇게 하면
  // 선택(selected 속성) 변경으로 노드가 갱신돼도 NVL 이 좌표를 되돌리지 않아
  // 사용자가 드래그로 옮긴 위치가 유지된다(스냅백 방지). det/force 공통.
  const nodes = useMemo(
    () => data.nodes.map((n) => toNvlNode(n, selectedId)),
    [data.nodes, selectedId],
  );
  const rels = useMemo(() => data.rels.map(toNvlRel), [data.rels]);

  // 노드 집합/레이아웃 변경 시 전체를 뷰포트에 맞춘다(워커 정착 대기 포함).
  const fitKey = useMemo(
    () => layoutMode + "|" + data.nodes.map((n) => n.id).sort().join(","),
    [data.nodes, layoutMode],
  );
  useEffect(() => {
    const ids = data.nodes.map((n) => n.id);
    const id = setTimeout(() => {
      const nvl = nvlRef.current;
      // force + 더 멀리: 워커 정착 후 좌표를 중심에서 바깥으로 스케일(간격 옵션 미노출 대응).
      if (nvl && !det && spread !== 1) {
        const ps = nvl.getNodePositions();
        if (ps.length) {
          const cx = ps.reduce((s, p) => s + p.x, 0) / ps.length;
          const cy = ps.reduce((s, p) => s + p.y, 0) / ps.length;
          nvl.setNodePositions(ps.map((p) => ({ id: p.id, x: cx + (p.x - cx) * spread, y: cy + (p.y - cy) * spread })));
        }
      }
      nvl?.fit(ids);
    }, det ? 200 : 1600);
    return () => clearTimeout(id);
  }, [fitKey, spread]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="nvl-host" data-layout-mode={layoutMode} data-renderer={webgl ? "webgl" : "canvas"}
         style={{ width: "100%", height: "100%" }}>
      <InteractiveNvlWrapper
        ref={nvlRef}
        nodes={nodes}
        rels={rels}
        {...(det ? { positions: pos } : { layout: "forceDirected" as const })}
        nvlOptions={{
          disableTelemetry: true, // §3.5 외부 전송 금지
          renderer: webgl ? "webgl" : "canvas",
          disableWebGL: !webgl, // config 토글(M8). 헤드리스는 canvas 유지.
        }}
        mouseEventCallbacks={{
          onNodeClick: (node) => onSelect(node.id),
          onPan: true,
          onZoom: true,
          onDrag: true, // 노드 드래그 이동 허용
        }}
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
}
