// 리뷰 항목 편집/액션 (§화면3 우) — [승인][거부][부착위치 수정 후 승인][별칭으로 흡수].
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { approveReview, rejectReview, absorbReview } from "../api";
import type { ReviewItem, GraphNode } from "../api";

interface Props {
  item: ReviewItem;
  nodes: GraphNode[]; // attach_to / 흡수 대상 선택용
  onDone: () => void;
}

export default function ReviewItemEditor({ item, nodes, onDone }: Props) {
  const qc = useQueryClient();
  const [attach, setAttach] = useState(item.attach_to ?? "");
  const [absorbTarget, setAbsorbTarget] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["reviewQueue"] });
    qc.invalidateQueries({ queryKey: ["graph"] });
    qc.invalidateQueries({ queryKey: ["status"] });
    qc.invalidateQueries({ queryKey: ["node"] });
  };
  const run = (fn: () => Promise<unknown>) =>
    fn().then(() => { invalidate(); onDone(); })
        .catch((e) => setErr(String(e)));

  const approveM = useMutation({ mutationFn: () => approveReview(item.rid, attach || item.attach_to) });
  const rejectM = useMutation({ mutationFn: () => rejectReview(item.rid) });
  const absorbM = useMutation({ mutationFn: () => absorbReview(item.rid, absorbTarget) });

  const processOrUnit = nodes.filter((n) => n.category === "Process" || n.category === "Unit");
  const isOrphan = item.kind.startsWith("orphan");

  return (
    <div className="editor">
      <div className="editor-head">
        <span className={`kind-badge ${isOrphan ? "orphan" : ""}`}>{item.kind}</span>
        <h3>{item.surface}</h3>
      </div>
      <dl className="nd-grid">
        <dt>category</dt><dd>{item.category}</dd>
        <dt>attach_to</dt><dd>{item.attach_to ?? <em>미지정 (orphan)</em>}</dd>
        {item.spec && (<><dt>spec</dt><dd>{item.spec}</dd></>)}
        {item.reason && (<><dt>사유</dt><dd>{item.reason}</dd></>)}
      </dl>

      <h4>근거 청크 ({item.evidence.length})</h4>
      {item.evidence.map((c) => (
        <div key={c.cid} className="chunk-card">
          <div className="chunk-meta">{c.cid} · {c.doc_id} · {c.section}</div>
          <div className="chunk-text">{c.text}</div>
        </div>
      ))}

      <div className="action-block">
        <h4>부착위치</h4>
        <select value={attach} onChange={(e) => setAttach(e.target.value)}>
          <option value="">— 선택 —</option>
          {processOrUnit.map((n) => (
            <option key={n.id} value={n.id}>{n.caption} ({n.id} · {n.category})</option>
          ))}
        </select>
        <div className="btn-row">
          <button
            className="primary"
            disabled={approveM.isPending}
            onClick={() => run(() => approveM.mutateAsync())}
          >
            {item.attach_to && attach === item.attach_to ? "승인" : "부착위치 수정 후 승인"}
          </button>
          <button disabled={rejectM.isPending} onClick={() => run(() => rejectM.mutateAsync())}>
            거부
          </button>
        </div>
      </div>

      <div className="action-block">
        <h4>기존 노드의 별칭으로 흡수</h4>
        <p className="muted">중복 노드 예방 — 표면형 "{item.surface}"를 기존 노드의 alias 로 추가.</p>
        <select value={absorbTarget} onChange={(e) => setAbsorbTarget(e.target.value)}>
          <option value="">— 흡수 대상 노드 —</option>
          {nodes.map((n) => (
            <option key={n.id} value={n.id}>{n.caption} ({n.id} · {n.category})</option>
          ))}
        </select>
        <button
          disabled={!absorbTarget || absorbM.isPending}
          onClick={() => run(() => absorbM.mutateAsync())}
        >
          별칭으로 흡수
        </button>
      </div>

      {err && <div className="result-bad">{err}</div>}
    </div>
  );
}
