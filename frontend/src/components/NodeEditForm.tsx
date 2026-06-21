// 기존 노드 편집 (§화면3 우) — canonical_name(id 불변)·definition·spec·status·aliases.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchNode, editNode, aliasNode } from "../api";
import type { GraphNode } from "../api";
import RelationEditor from "./RelationEditor";

interface Props {
  nodeId: string;
  nodes: GraphNode[];
  onDone: () => void;
}

export default function NodeEditForm({ nodeId, nodes, onDone }: Props) {
  const qc = useQueryClient();
  const node = useQuery({ queryKey: ["node", nodeId], queryFn: () => fetchNode(nodeId) });

  const [name, setName] = useState("");
  const [def, setDef] = useState("");
  const [spec, setSpec] = useState("");
  const [status, setStatus] = useState("proposed");
  const [newAlias, setNewAlias] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (node.data) {
      setName(node.data.canonical_name);
      setDef(node.data.definition ?? "");
      setSpec(node.data.spec ?? "");
      setStatus(node.data.status);
    }
  }, [node.data]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["node", nodeId] });
    qc.invalidateQueries({ queryKey: ["graph"] });
    qc.invalidateQueries({ queryKey: ["status"] });
  };

  async function save() {
    setMsg(null);
    try {
      await editNode(nodeId, {
        canonical_name: name,
        definition: def,
        spec: spec || null,
        status,
      });
      invalidate();
      setMsg("✓ 저장됨");
      onDone();
    } catch (e) {
      setMsg(String(e));
    }
  }

  async function alias(op: "add" | "remove", a: string) {
    if (!a) return;
    try {
      await aliasNode(nodeId, op, a);
      qc.invalidateQueries({ queryKey: ["node", nodeId] });
      qc.invalidateQueries({ queryKey: ["graph"] });
      setNewAlias("");
    } catch (e) {
      setMsg(String(e));
    }
  }

  if (node.isLoading || !node.data) return <div className="editor">불러오는 중…</div>;
  const n = node.data;

  return (
    <div className="editor">
      <div className="editor-head">
        <h3>노드 편집</h3>
        <span className="nd-id">{n.id} · {n.category} · id 불변</span>
      </div>

      <label className="fld">canonical_name
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="fld">definition
        <textarea value={def} onChange={(e) => setDef(e.target.value)} rows={2} />
      </label>
      <label className="fld">spec
        <input value={spec} onChange={(e) => setSpec(e.target.value)} placeholder="(Property)" />
      </label>
      <label className="fld">status
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="proposed">proposed</option>
          <option value="confirmed">confirmed</option>
        </select>
      </label>

      <button className="primary" onClick={save}>저장</button>

      <div className="action-block">
        <h4>aliases</h4>
        <div className="alias-chips">
          {n.aliases.length === 0 && <span className="muted">없음</span>}
          {n.aliases.map((a) => (
            <span key={a} className="alias-chip">
              {a} <button className="x" onClick={() => alias("remove", a)}>×</button>
            </span>
          ))}
        </div>
        <div className="btn-row">
          <input
            value={newAlias}
            onChange={(e) => setNewAlias(e.target.value)}
            placeholder="새 별칭"
            onKeyDown={(e) => e.key === "Enter" && alias("add", newAlias)}
          />
          <button onClick={() => alias("add", newAlias)}>추가</button>
        </div>
      </div>

      {msg && <div className={msg.startsWith("✓") ? "result-ok" : "result-bad"}>{msg}</div>}

      <RelationEditor node={n} nodes={nodes} />
    </div>
  );
}
