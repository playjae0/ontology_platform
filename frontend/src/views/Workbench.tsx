// 화면3 — 검수/승인/편집 Workbench · 좌우 분할.
// 좌(½) NVL 그래프(맥락) — 노드 클릭 → 우측 노드 편집폼.
// 우(½) 리뷰 큐(일괄 승인) + 선택 항목 에디터(리뷰 항목 / 노드).
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchGraph, fetchReviewQueue, approveBatch } from "../api";
import GraphCanvas from "../components/GraphCanvas";
import ReviewItemEditor from "../components/ReviewItemEditor";
import NodeEditForm from "../components/NodeEditForm";

type Sel = { kind: "review"; rid: string } | { kind: "node"; id: string } | null;

export default function Workbench() {
  const qc = useQueryClient();
  const [sel, setSel] = useState<Sel>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());

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
  const nodes = graph.data?.nodes ?? [];
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
    <div className="workbench">
      <div className="wb-left">
        {graph.data && graph.data.nodes.length > 0 ? (
          <GraphCanvas
            data={graph.data}
            selectedId={sel?.kind === "node" ? sel.id : null}
            onSelect={(id) => setSel({ kind: "node", id })}
          />
        ) : (
          <div className="center-msg">그래프 로딩…</div>
        )}
        <div className="legend">
          <span className="muted">노드 클릭 → 우측 편집 · 리뷰 항목은 우측 목록에서</span>
        </div>
      </div>

      <div className="wb-right">
        <section className="queue-section">
          <div className="queue-head">
            <h3>리뷰 큐 ({items.length})</h3>
            <button
              disabled={checked.size === 0 || batchM.isPending}
              onClick={() => batchM.mutate([...checked])}
            >
              일괄 승인 ({checked.size})
            </button>
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
