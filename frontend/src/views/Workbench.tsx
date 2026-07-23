// 화면3 — 검수/승인/편집 Workbench · 좌우 분할.
// 좌(½) NVL 그래프(맥락) — 노드 클릭 → 우측 노드 편집폼.
// 우(½) 리뷰 큐(일괄 승인) + 선택 항목 에디터(리뷰 항목 / 노드).
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchGraph, fetchReviewQueue, approveBatch, API_BASE } from "../api";
import GraphCanvas from "../components/GraphCanvas";
import GraphFilterBar from "../components/GraphFilterBar";
import ReviewItemEditor from "../components/ReviewItemEditor";
import NodeEditForm from "../components/NodeEditForm";
import { applyGraphFilters, defaultFilters } from "../graphFilters";

type Sel = { kind: "review"; rid: string } | { kind: "node"; id: string } | null;

export default function Workbench() {
  const qc = useQueryClient();
  const [sel, setSel] = useState<Sel>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState(defaultFilters());

  // 좌우 분할 비율(%) — 드래그로 조절(드래그만; 새로고침 시 50:50 초기화).
  const [leftPct, setLeftPct] = useState(50);
  const wrapRef = useRef<HTMLDivElement>(null);
  function startDrag(e: React.MouseEvent) {
    e.preventDefault();
    const el = wrapRef.current;
    if (!el) return;
    const move = (ev: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      setLeftPct(Math.min(80, Math.max(20, pct)));
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.classList.remove("col-resizing");
    };
    document.body.classList.add("col-resizing");
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  const graph = useQuery({ queryKey: ["graph", null], queryFn: () => fetchGraph(null) });
  const queue = useQuery({ queryKey: ["reviewQueue"], queryFn: fetchReviewQueue });

  const batchM = useMutation({
    mutationFn: (rids: string[]) => approveBatch(rids),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reviewQueue"] });
      qc.invalidateQueries({ queryKey: ["graph"] });
      qc.invalidateQueries({ queryKey: ["status"] });
      setChecked(new Set());
      setSel(null);
    },
  });

  const items = queue.data?.items ?? [];
  const orphans = queue.data?.orphans ?? [];
  const nodes = graph.data?.nodes ?? []; // 편집폼·피커는 전체 노드 목록 필요(필터 무관)
  // 캔버스 렌더에만 카테고리/관계 필터 적용(읽기 전용 표시 필터).
  const canvasGraph = useMemo(
    () => (graph.data ? applyGraphFilters(graph.data, filters) : undefined),
    [graph.data, filters],
  );
  const selItem = useMemo(
    () => (sel?.kind === "review" ? items.find((i) => i.rid === sel.rid) : undefined),
    [sel, items],
  );

  function toggle(rid: string) {
    const next = new Set(checked);
    next.has(rid) ? next.delete(rid) : next.add(rid);
    setChecked(next);
  }

  // 일괄 승인 대상: orphan(미부착) 제외 — 백엔드가 skip 처리하지만 UI 에서도 안내
  const batchable = items.filter((i) => i.attach_to);

  return (
    <div
      className="workbench"
      ref={wrapRef}
      style={{ gridTemplateColumns: `${leftPct}% 6px ${100 - leftPct}%` }}
    >
      <div className="wb-left">
        <GraphFilterBar filters={filters} onChange={setFilters} />
        <div className="wb-canvas">
          {canvasGraph && graph.data && graph.data.nodes.length > 0 ? (
            canvasGraph.nodes.length > 0 ? (
              <GraphCanvas
                data={canvasGraph}
                selectedId={sel?.kind === "node" ? sel.id : null}
                onSelect={(id) => setSel({ kind: "node", id })}
              />
            ) : (
              <div className="center-msg">필터에 맞는 노드가 없습니다.</div>
            )
          ) : (
            <div className="center-msg">그래프 로딩…</div>
          )}
        </div>
        <div className="legend">
          <span className="muted">노드 클릭 → 우측 편집 · 리뷰 항목은 우측 목록에서</span>
        </div>
      </div>

      <div
        className="wb-splitter"
        onMouseDown={startDrag}
        role="separator"
        aria-orientation="vertical"
        title="드래그해서 좌우 폭 조절"
      />

      <div className="wb-right">
        <section className="queue-section">
          <div className="queue-head">
            <h3>리뷰 큐 ({items.length})</h3>
            <div className="qh-actions">
              <a className="btn-link sm" href={`${API_BASE}/export/skeleton`} download
                 title="편집 결과가 반영된 뼈대 JSON 내려받기">편집 JSON ↓</a>
              <button
                disabled={checked.size === 0 || batchM.isPending}
                onClick={() => batchM.mutate([...checked])}
              >
                일괄 승인 ({checked.size})
              </button>
            </div>
          </div>
          {batchM.data && (
            <div className="result-ok">
              승인 {(batchM.data as { approved: string[] }).approved.length} ·
              스킵 {((batchM.data as { skipped?: unknown[] }).skipped ?? []).length}
            </div>
          )}
          {items.length === 0 && <div className="muted">큐가 비었습니다.</div>}
          <ul className="queue-list">
            {items.map((it) => (
              <li
                key={it.rid}
                className={sel?.kind === "review" && sel.rid === it.rid ? "active" : ""}
              >
                <input
                  type="checkbox"
                  checked={checked.has(it.rid)}
                  disabled={!it.attach_to}
                  title={it.attach_to ? "" : "orphan — 부착위치 지정 후 개별 승인"}
                  onChange={() => toggle(it.rid)}
                />
                <button className="queue-item" onClick={() => setSel({ kind: "review", rid: it.rid })}>
                  <span className={`kind-badge ${it.kind.startsWith("orphan") ? "orphan" : ""}`}>
                    {it.kind}
                  </span>
                  <strong>{it.surface}</strong>
                  <span className="muted">→ {it.attach_to ?? "미부착"}</span>
                </button>
              </li>
            ))}
          </ul>
          {batchable.length < items.length && (
            <p className="muted">※ 미부착(orphan) 항목은 일괄 승인 제외 — 개별 부착 후 승인.</p>
          )}

          {orphans.length > 0 && (
            <div className="orphan-box">
              <div className="rel-title">고아 노드 ({orphans.length}) — 재연결 필요</div>
              <p className="muted">구조적 부모가 사라진 노드. 노드를 클릭해 "관계" 섹션에서 part_of 추가로 재연결.</p>
              {orphans.map((o) => (
                <button
                  key={o.node_id}
                  className="orphan-item"
                  onClick={() => setSel({ kind: "node", id: o.node_id })}
                >
                  <span className="kind-badge orphan">{o.kind}</span>
                  <strong>{o.surface}</strong>
                  <span className="muted">{o.node_id} · {o.category}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="editor-section">
          {selItem && (
            <ReviewItemEditor item={selItem} nodes={nodes} onDone={() => setSel(null)} />
          )}
          {sel?.kind === "node" && (
            <NodeEditForm nodeId={sel.id} nodes={nodes} onDone={() => { /* 유지 */ }} />
          )}
          {!sel && <div className="panel-empty">리뷰 항목 또는 그래프 노드를 선택하세요.</div>}
        </section>
      </div>
    </div>
  );
}
