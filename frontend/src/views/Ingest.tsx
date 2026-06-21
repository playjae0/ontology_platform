// 화면5 — 인입 워크스페이스 (M9). 배치 단계별 흐름. 스테이지 슬롯(M4) 위 오케스트레이션.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchBatch, batchUpload, batchRun, batchReset, fetchBatchDoc, fetchReviewQueue,
} from "../api";
import type { BatchDoc } from "../api";

const STEPS = ["① 업로드", "② 파싱", "③ 뼈대", "④ 검수·승인", "⑤ 콘텐츠 연결"];

interface Props { onGotoWorkbench: () => void }

export default function Ingest({ onGotoWorkbench }: Props) {
  const qc = useQueryClient();
  const [names, setNames] = useState("노칭_사양서.pdf, 스태킹_품질.pdf");
  const [openDoc, setOpenDoc] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const batch = useQuery({ queryKey: ["batch"], queryFn: fetchBatch });
  const queue = useQuery({ queryKey: ["reviewQueue"], queryFn: fetchReviewQueue });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["batch"] });
    qc.invalidateQueries({ queryKey: ["reviewQueue"] });
    qc.invalidateQueries({ queryKey: ["graph"] });
    qc.invalidateQueries({ queryKey: ["status"] });
  };
  const run = (fn: () => Promise<unknown>) =>
    fn().then(invalidate).catch((e) => setErr(String(e)));

  const uploadM = useMutation({ mutationFn: () => batchUpload(names.split(",").map((s) => s.trim()).filter(Boolean)) });
  const resetM = useMutation({ mutationFn: batchReset });

  const docs = batch.data?.docs ?? [];
  const allParsed = docs.length > 0 && docs.every((d) => d.parse === "done");
  const skeletonRan = batch.data?.stage_skeleton === "ran";
  const pendingBatch = (queue.data?.items ?? []).filter((i) => (i as { from_batch?: boolean }).from_batch).length;
  const allLinked = docs.length > 0 && docs.every((d) => d.link === "done");

  // 현재 단계 인덱스(진행바)
  const stepIdx = useMemo(() => {
    if (allLinked) return 4;
    if (skeletonRan && pendingBatch === 0) return 4;
    if (skeletonRan) return 3;
    if (allParsed) return 2;
    if (docs.length) return 1;
    return 0;
  }, [docs.length, allParsed, skeletonRan, pendingBatch, allLinked]);

  return (
    <div className="ingest">
      {/* 진행바 */}
      <ol className="ingest-steps">
        {STEPS.map((s, i) => (
          <li key={s} className={i < stepIdx ? "done" : i === stepIdx ? "active" : ""}>{s}</li>
        ))}
      </ol>

      {err && <div className="result-bad" onClick={() => setErr(null)}>{err}</div>}

      {/* ① 업로드 */}
      <section className="ingest-band">
        <h3>① 문서 업로드 (배치)</h3>
        <div className="btn-row">
          <input className="search-input" style={{ flex: 1 }} value={names}
            onChange={(e) => setNames(e.target.value)} placeholder="문서명 쉼표 구분" />
          <button onClick={() => run(() => uploadM.mutateAsync())}>업로드</button>
          <button onClick={() => run(() => resetM.mutateAsync())}>배치 초기화</button>
        </div>
        <p className="muted">데모: MockStage 가 결정적 샘플을 산출(사외 시연). 사내 코드는 config 로 external 스왑.</p>
      </section>

      {/* ②④⑤ 실행 컨트롤 */}
      <section className="ingest-band">
        <div className="ingest-actions">
          <Step n="②" label="파싱 (문서별)" enabled={docs.length > 0}
            onClick={() => run(() => batchRun("parse"))} done={allParsed} />
          <Step n="③" label="뼈대 (배치 공유)" enabled={allParsed && !skeletonRan}
            hint={!allParsed ? "②파싱 필요" : ""} onClick={() => run(() => batchRun("skeleton"))} done={skeletonRan} />
          <Step n="④" label={`검수·승인 (큐 ${pendingBatch})`} enabled={skeletonRan && pendingBatch > 0}
            hint={!skeletonRan ? "③뼈대 필요" : pendingBatch === 0 ? "검수 완료" : ""}
            onClick={onGotoWorkbench} done={skeletonRan && pendingBatch === 0} actionLabel="Workbench 로" />
          <Step n="⑤" label="콘텐츠 연결 (문서별)" enabled={skeletonRan && pendingBatch === 0 && !allLinked}
            hint={!skeletonRan ? "③뼈대 필요" : pendingBatch > 0 ? "④검수 미완료" : ""}
            onClick={() => run(() => batchRun("content"))} done={allLinked} />
        </div>
      </section>

      {/* 배치 테이블 */}
      <section className="ingest-band">
        <h3>배치 ({docs.length}문서)</h3>
        {docs.length === 0 ? <p className="muted">업로드된 문서 없음.</p> : (
          <table className="batch-table">
            <thead><tr><th>문서</th><th>파싱</th><th>청크</th><th>연결</th><th>describes</th><th>orphan</th></tr></thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.doc_id} className={openDoc === d.doc_id ? "open" : ""}
                  onClick={() => setOpenDoc(openDoc === d.doc_id ? null : d.doc_id)}>
                  <td><strong>{d.name}</strong> <span className="muted">{d.doc_id}</span></td>
                  <td><Chip ok={d.parse === "done"}>{d.parse === "done" ? "파싱" : "대기"}</Chip></td>
                  <td>{d.chunks}</td>
                  <td><Chip ok={d.link === "done"}>{d.link === "done" ? "연결" : "대기"}</Chip></td>
                  <td>{d.describes}</td>
                  <td className={d.orphans > 0 ? "cov-empty" : ""}>{d.orphans}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {openDoc && <DocPreview docId={openDoc} />}
      </section>
    </div>
  );
}

function Step({ n, label, enabled, onClick, done, hint, actionLabel }: {
  n: string; label: string; enabled: boolean; onClick: () => void; done?: boolean; hint?: string; actionLabel?: string;
}) {
  return (
    <div className={`ingest-step ${done ? "done" : ""}`} data-step={n}>
      <div className="is-label"><b>{n}</b> {label}</div>
      <button disabled={!enabled} title={hint} onClick={onClick}>
        {done ? "✓ 완료" : actionLabel ?? "실행"}
      </button>
      {hint && !enabled && <span className="muted">{hint}</span>}
    </div>
  );
}

function Chip({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return <span className={ok ? "badge-active" : "badge-stub"}>{children}</span>;
}

function DocPreview({ docId }: { docId: string }) {
  const q = useQuery({ queryKey: ["batchDoc", docId], queryFn: () => fetchBatchDoc(docId) });
  if (!q.data) return null;
  const linked = new Set(q.data.describes.map((d) => d.source));
  return (
    <div className="doc-preview">
      <h4>{docId} — 청크 {q.data.chunks.length} · describes {q.data.describes.length}</h4>
      {q.data.chunks.map((c) => (
        <div key={c.cid} className="chunk-card">
          <div className="chunk-meta">
            {c.cid} · {c.section} {linked.has(c.cid) ? <span className="badge-active">연결됨</span> : <span className="badge-stub">미연결</span>}
          </div>
          <div className="chunk-text">{c.text}</div>
        </div>
      ))}
    </div>
  );
}
