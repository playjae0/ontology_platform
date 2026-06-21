// 중앙 NVL 캔버스 (§화면2 중앙). 읽기 전용.
// ⚠️ disableTelemetry: true 필수 (§3.5 — 외부 전송 금지).
// §3.5: Canvas 렌더(WebGL은 대규모용·나중). 좌표는 클라이언트에서 결정적으로 산출(layout.ts)하여
//        NVL 워커 레이아웃 의존을 제거. 노드 집합 변경 시 fit() 으로 뷰포트 맞춤.
import { useEffect, useMemo, useRef } from "react";
import type NVL from "@neo4j-nvl/base";
import { InteractiveNvlWrapper } from "@neo4j-nvl/react";
import type { GraphData } from "../api";
import { toNvlNode, toNvlRel } from "../theme";
import { computeLayout } from "../layout";

interface Props {
  data: GraphData;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export default function GraphCanvas({ data, selectedId, onSelect }: Props) {
  const nvlRef = useRef<NVL | null>(null);

  const positions = useMemo(() => computeLayout(data), [data]);

  const nodes = useMemo(
    () =>
      data.nodes.map((n) => {
        const p = positions.find((q) => q.id === n.id)!;
        return { ...toNvlNode(n, selectedId), x: p.x, y: p.y };
      }),
    [data.nodes, positions, selectedId],
  );
  const rels = useMemo(() => data.rels.map(toNvlRel), [data.rels]);

  // 노드 집합이 바뀌면(스코프/필터 변경) 전체를 뷰포트에 맞춘다.
  const fitKey = useMemo(() => data.nodes.map((n) => n.id).sort().join(","), [data.nodes]);
  useEffect(() => {
    const id = setTimeout(() => nvlRef.current?.fit(data.nodes.map((n) => n.id)), 200);
    return () => clearTimeout(id);
  }, [fitKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <InteractiveNvlWrapper
      ref={nvlRef}
      nodes={nodes}
      rels={rels}
      positions={positions}
      nvlOptions={{
        disableTelemetry: true, // §3.5 외부 전송 금지
        renderer: "canvas", // §3.5 Canvas 렌더(WebGL은 대규모용·나중)
        disableWebGL: true, // WebGL 프로빙/컨텍스트 의존 제거
      }}
      mouseEventCallbacks={{
        onNodeClick: (node) => onSelect(node.id),
        onPan: true,
        onZoom: true,
        onDrag: true,
      }}
      style={{ width: "100%", height: "100%" }}
    />
  );
}
