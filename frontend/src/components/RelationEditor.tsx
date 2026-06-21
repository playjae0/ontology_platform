// 관계(엣지) 편집 (§M5) — NodeEditForm 하단 "관계" 섹션.
// target 노드가 주인공: [relation ▾(작게)] → [target 콤보박스(넓게)] [삭제].
// 노드 선택은 검색형 콤보박스(NodePicker, name/alias/id).
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { editEdge } from "../api";
import type { NodeDetail, GraphNode, Adjacency } from "../api";
import NodePicker from "./NodePicker";

const RELATIONS = ["part_of", "precedes", "has_property"];

const REL_GROUP: { key: string; dir: "out" | "in"; title: string }[] = [
  { key: "part_of", dir: "out", title: "부모 (part_of 대상)" },
  { key: "part_of", dir: "in", title: "자식 (part_of)" },
  { key: "precedes", dir: "in", title: "precedes 이전" },
  { key: "precedes", dir: "out", title: "precedes 이후" },
  { key: "has_property", dir: "out", title: "has_property 인자" },
  { key: "has_property", dir: "in", title: "has_property 소유(부모)" },
];

interface Props {
  node: NodeDetail;
  nodes: GraphNode[];
}

export default function RelationEditor({ node, nodes }: Props) {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<string | null>(null);
  const [addRel, setAddRel] = useState("part_of");
  const [addTarget, setAddTarget] = useState("");

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["node", node.id] });
    qc.invalidateQueries({ queryKey: ["graph"] });
    qc.invalidateQueries({ queryKey: ["status"] });
    qc.invalidateQueries({ queryKey: ["reviewQueue"] });
  };

  async function run(p: Promise<{ ok: boolean; warning?: string | null }>) {
    setMsg(null);
    try {
      const r = await p;
      invalidate();
      setMsg(r.warning ? `⚠ ${r.warning}` : "✓ 적용됨");
    } catch (e) {
      setMsg(`✗ ${String(e)}`);
    }
  }

  // adjacency → 엣지 triple 복원. dir out: (node, rel, other) / dir in: (other, rel, node)
  const triple = (a: Adjacency) =>
    a.dir === "out"
      ? { source: node.id, relation: a.relation, target: a.other }
      : { source: a.other, relation: a.relation, target: node.id };

  const retarget = (a: Adjacency, far: string) => {
    if (!far || far === a.other) return;
    const t = triple(a);
    return run(editEdge({ ...t, op: "update", ...(a.dir === "out" ? { new_target: far } : { new_source: far }) }));
  };
  const retype = (a: Adjacency, rel: string) =>
    run(editEdge({ ...triple(a), op: "update", new_relation: rel }));
  const del = (a: Adjacency) => run(editEdge({ ...triple(a), op: "delete" }));

  return (
    <div className="action-block">
      <h4>관계 (엣지) 편집</h4>

      {REL_GROUP.map((g) => {
        const rows = node.adjacency.filter((a) => a.relation === g.key && a.dir === g.dir);
        if (rows.length === 0) return null;
        return (
          <div key={`${g.key}-${g.dir}`} className="rel-group">
            <div className="rel-title">{g.title}</div>
            {rows.map((a, i) => (
              <div key={i} className="rel-row">
                <select
                  className="rel-type"
                  value={a.relation}
                  onChange={(e) => retype(a, e.target.value)}
                  title="타입 변경"
                >
                  {RELATIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <span className="rel-arrow">{a.dir === "out" ? "→" : "←"}</span>
                {/* target(연결 상대) = 주인공. 콤보박스로 현재 대상 표시 + 재지정 */}
                <NodePicker
                  value={a.other}
                  nodes={nodes}
                  exclude={node.id}
                  onChange={(far) => retarget(a, far)}
                />
                <button className="rel-del" title="삭제" onClick={() => del(a)}>삭제</button>
              </div>
            ))}
          </div>
        );
      })}

      <div className="rel-add">
        <div className="rel-title">관계 추가 (이 노드가 source)</div>
        <div className="rel-row">
          <select className="rel-type" value={addRel} onChange={(e) => setAddRel(e.target.value)}>
            {RELATIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <span className="rel-arrow">→</span>
          <NodePicker
            value={addTarget}
            nodes={nodes}
            exclude={node.id}
            onChange={setAddTarget}
            placeholder="target 노드 검색 (이름·별칭·id)"
          />
          <button
            className="rel-add-btn"
            disabled={!addTarget}
            onClick={() =>
              run(editEdge({ op: "add", source: node.id, relation: addRel, target: addTarget }))
                .then(() => setAddTarget(""))
            }
          >
            추가
          </button>
        </div>
      </div>

      {msg && (
        <div className={msg.startsWith("✓") ? "result-ok" : msg.startsWith("⚠") ? "result-warn" : "result-bad"}>
          {msg}
        </div>
      )}
    </div>
  );
}
