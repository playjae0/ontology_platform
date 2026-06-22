// 화면7 — 문서관리 / 정보 저장소 (M13). 출처·provenance 브라우징. 읽기 전용·additive.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchDocuments, fetchDocument, fetchNodeProvenance } from "../api";
import type { DocSummary } from "../api";
import { categoryColor } from "../theme";

interface Props { onJump: (nodeId: string) => void }

export default function Documents({ onJump }: Props) {
  const docs = useQuery({ queryKey: ["documents"], queryFn: fetchDocuments });
  const [sel, setSel] = useState<{ kind: "doc"; id: string } | { kind: "node"; id: string } | null>(null);

  // 공정별 그룹 (각 공정 → 그 공정 닿는 문서). 공정 미해당/이벤트는 별도.
  const groups: Record<string, DocSummary[]> = {};
  const noProc: DocSummary[] = [];
  for (const d of docs.data ?? []) {
    if (d.processes.length === 0) noProc.push(d);
    for (const p of d.processes) (groups[p] ??= []).push(d);
  }

  return (
    <div className="documents">
      <aside className="doc-catalog">
        <h3>문서 카탈로그 ({docs.data?.length ?? 0})</h3>
        {Object.entries(groups).map(([proc, list]) => (
          <div key={proc} className="doc-group">
            <div className="doc-group-h">{proc} <span className="muted">{list.length}</span></div>
            {list.map((d) => <DocCard key={d.doc_id} d={d} active={sel?.kind === "doc" && sel.id === d.doc_id} onClick={() => setSel({ kind: "doc", id: d.doc_id })} />)}
          </div>
        ))}
        {noProc.length > 0 && (
          <div className="doc-group">
            <div className="doc-group-h">미연결 <span className="muted">{noProc.length}</span></div>
            {noProc.map((d) => <DocCard key={d.doc_id} d={d} active={sel?.kind === "doc" && sel.id === d.doc_id} onClick={() => setSel({ kind: "doc", id: d.doc_id })} />)}
          </div>
        )}
      </aside>

      <main className="doc-detail">
        {!sel && <div className="panel-empty">문서를 선택하면 청크·출처가 표시됩니다.</div>}
        {sel?.kind === "doc" && <DocDetailView docId={sel.id} onNode={(id) => setSel({ kind: "node", id })} onJump={onJump} />}
        {sel?.kind === "node" && <NodeProvenanceView nodeId={sel.id} onJump={onJump} />}
      </main>
    </div>
  );
}

function DocCard({ d, active, onClick }: { d: DocSummary; active: boolean; onClick: () => void }) {
  return (
    <button className={`doc-card ${active ? "active" : ""}`} onClick={onClick}>
      <div className="doc-card-h"><strong>{d.doc_id}</strong>
        <span className={`layer-badge ${d.layer}`}>{d.layer === "event" ? "이벤트" : d.layer === "both" ? "혼합" : "구조"}</span>
      </div>
      <div className="muted">청크 {d.chunk_count} · 노드 {d.node_count}</div>
    </button>
  );
}

function DocDetailView({ docId, onNode, onJump }: { docId: string; onNode: (id: string) => void; onJump: (id: string) => void }) {
  const q = useQuery({ queryKey: ["document", docId], queryFn: () => fetchDocument(docId) });
  if (!q.data) return <div className="panel-empty">불러오는 중…</div>;
  return (
    <div className="doc-view">
      <h2>{docId}</h2>
      <div className="footprint">
        <span className="muted">그래프 발자국:</span>
        {q.data.footprint.map((f) => (
          <button key={f.id} className="fp-node" onClick={() => onNode(f.id)} title="출처(역방향) 보기">
            <i className="cat-dot" style={{ background: categoryColor(f.category) }} />{f.name}
          </button>
        ))}
        {q.data.footprint.length === 0 && <span className="muted">연결 노드 없음</span>}
      </div>
      {q.data.chunks.map((c) => (
        <div key={c.cid} className="chunk-card">
          <div className="chunk-meta">
            {c.cid} · {c.section}
            {Object.keys(c.meta || {}).length > 0 && <span className="meta-pill"> {JSON.stringify(c.meta)}</span>}
          </div>
          <div className="chunk-text">{c.text}</div>
          {c.describes.length > 0 && (
            <div className="chunk-describes">
              <span className="muted">describes:</span>
              {c.describes.map((t) => (
                <span key={t.id} className="describe-tag">
                  <button onClick={() => onNode(t.id)}><i className="cat-dot" style={{ background: categoryColor(t.category) }} />{t.name}</button>
                  <button className="jump" title="Explore 점프" onClick={() => onJump(t.id)}>↗</button>
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function NodeProvenanceView({ nodeId, onJump }: { nodeId: string; onJump: (id: string) => void }) {
  const q = useQuery({ queryKey: ["provenance", nodeId], queryFn: () => fetchNodeProvenance(nodeId) });
  if (!q.data) return <div className="panel-empty">불러오는 중…</div>;
  const p = q.data;
  return (
    <div className="doc-view">
      <div className="editor-head">
        <span className="cat-dot" style={{ background: categoryColor(p.category) }} />
        <h2>{p.name}</h2>
        <span className="muted">{p.category} · {p.id}</span>
        <button className="jump" onClick={() => onJump(p.id)} title="Explore 점프">Explore ↗</button>
      </div>
      <h4>이 노드를 만든/연결한 문서·청크 (역방향)</h4>
      {p.describes_chunks.length === 0 && <p className="muted">describes 청크 없음.</p>}
      {p.describes_chunks.map((c) => (
        <div key={c.cid} className="chunk-card">
          <div className="chunk-meta">{c.doc_id} · {c.cid} · {c.section}
            {Object.keys(c.meta || {}).length > 0 && <span className="meta-pill"> {JSON.stringify(c.meta)}</span>}
          </div>
          <div className="chunk-text">{c.text}</div>
        </div>
      ))}
      {p.provenance.length > 0 && (
        <>
          <h4>node.provenance</h4>
          {p.provenance.map((pr, i) => <div key={i} className="muted">· {pr.doc_id} ({pr.surface})</div>)}
        </>
      )}
    </div>
  );
}
