// 우측 노드 상세 패널 (§화면2 우). 상세 + describes 청크 원문 + 인접관계.
import { useQuery } from "@tanstack/react-query";
import { fetchNode, fetchNodeChunks } from "../api";
import { categoryColor } from "../theme";

interface Props {
  nodeId: string | null;
}

export default function NodePanel({ nodeId }: Props) {
  const node = useQuery({
    queryKey: ["node", nodeId],
    queryFn: () => fetchNode(nodeId!),
    enabled: !!nodeId,
  });
  const chunks = useQuery({
    queryKey: ["chunks", nodeId],
    queryFn: () => fetchNodeChunks(nodeId!),
    enabled: !!nodeId,
  });

  if (!nodeId) return <div className="panel-empty">노드를 클릭하면 상세가 표시됩니다.</div>;
  if (node.isLoading) return <div className="panel-empty">불러오는 중…</div>;
  if (node.isError || !node.data)
    return <div className="panel-empty">상세를 불러오지 못했습니다.</div>;

  const n = node.data;
  return (
    <div className="node-detail">
      <div className="nd-head">
        <span className="cat-dot" style={{ background: categoryColor(n.category) }} />
        <h2>{n.canonical_name}</h2>
        <span className={`status-badge ${n.status}`}>{n.status}</span>
      </div>
      <div className="nd-id">
        {n.id} · {n.category}
      </div>

      {n.definition && <p className="nd-def">{n.definition}</p>}

      <dl className="nd-grid">
        {n.spec && (
          <>
            <dt>spec</dt>
            <dd>{n.spec}</dd>
          </>
        )}
        {n.attached_to && (
          <>
            <dt>attached_to</dt>
            <dd>{n.attached_to}</dd>
          </>
        )}
        <dt>aliases</dt>
        <dd>{n.aliases.length ? n.aliases.join(", ") : <em>없음</em>}</dd>
      </dl>

      <section>
        <h3>근거 청크 ({chunks.data?.length ?? 0})</h3>
        {chunks.isLoading && <div className="muted">불러오는 중…</div>}
        {chunks.data?.length === 0 && <div className="muted">연결된 청크 없음.</div>}
        {chunks.data?.map((c) => (
          <div key={c.cid} className="chunk-card">
            <div className="chunk-meta">
              {c.cid} · {c.doc_id} · {c.section}
            </div>
            <div className="chunk-text">{c.text}</div>
          </div>
        ))}
      </section>

      <section>
        <h3>인접 관계 ({n.adjacency.length})</h3>
        <ul className="adj-list">
          {n.adjacency.map((a, i) => (
            <li key={i}>
              <span className={`arrow ${a.dir}`}>{a.dir === "out" ? "→" : "←"}</span>
              <code>{a.relation}</code> {a.other_name}{" "}
              <span className="muted">({a.other})</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
