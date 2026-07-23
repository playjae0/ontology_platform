// 관계(엣지) 편집 (§M5) — NodeEditForm 하단 "관계" 섹션.
// target 노드가 주인공: [relation ▾(작게)] → [target 콤보박스(넓게)] [그래프클릭][삭제].
// 유효성 제약(relationRules): 무효 조합(예: Unit→precedes) 은 애초에 선택 불가.
// 그래프 클릭 선택: requestPick 으로 좌측 그래프 노드를 클릭해 대상 입력.
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { editEdge } from "../api";
import type { NodeDetail, GraphNode, Adjacency } from "../api";
import NodePicker from "./NodePicker";
import {
  relationsForSource,
  relationsForPair,
  targetCatsFor,
  sourceCatsFor,
} from "../relationRules";

const REL_GROUP: { key: string; dir: "out" | "in"; title: string }[] = [
  { key: "part_of", dir: "out", title: "부모 (part_of 대상)" },
  { key: "part_of", dir: "in", title: "자식 (part_of)" },
  { key: "precedes", dir: "in", title: "precedes 이전" },
  { key: "precedes", dir: "out", title: "precedes 이후" },
  { key: "has_property", dir: "out", title: "has_property 인자" },
  { key: "has_property", dir: "in", title: "has_property 소유(부모)" },
  { key: "causes", dir: "out", title: "causes (원인→불량)" },
  { key: "causes", dir: "in", title: "causes 원인" },
  { key: "affects", dir: "out", title: "affects (불량→영향)" },
  { key: "affects", dir: "in", title: "affects 원인" },
];

interface Props {
  node: NodeDetail;
  nodes: GraphNode[];
  // 그래프 클릭으로 대상 선택(Workbench 가 좌측 그래프 클릭을 여기로 라우팅).
  requestPick?: (cb: (id: string) => void) => void;
  picking?: boolean;
  cancelPick?: () => void;
}

export default function RelationEditor({ node, nodes, requestPick, picking, cancelPick }: Props) {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<string | null>(null);
  const catOf = useMemo(() => {
    const m = new Map(nodes.map((n) => [n.id, n.category]));
    return (id: string) => m.get(id);
  }, [nodes]);

  // 이 노드가 source 로서 만들 수 있는 관계
  const addableRels = relationsForSource(node.category);
  const [addRel, setAddRel] = useState(addableRels[0] ?? "");
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
  const retype = (a: Adjacency, rel: string) => {
    if (rel === a.relation) return;
    return run(editEdge({ ...triple(a), op: "update", new_relation: rel }));
  };
  const del = (a: Adjacency) => run(editEdge({ ...triple(a), op: "delete" }));

  // 엣지 한 행의 (source,target) 카테고리 → 유효 타입 목록
  const relOptionsFor = (a: Adjacency): string[] => {
    const srcCat = a.dir === "out" ? node.category : catOf(a.other);
    const tgtCat = a.dir === "out" ? catOf(a.other) : node.category;
    const valid = relationsForPair(srcCat, tgtCat);
    return Array.from(new Set([a.relation, ...valid])); // 현재값 항상 포함
  };
  // 재지정 시 상대편(변경 대상) 노드의 유효 카테고리
  const retargetCats = (a: Adjacency): string[] =>
    a.dir === "out" ? targetCatsFor(a.relation) : sourceCatsFor(a.relation);

  // 그래프 클릭 픽 — 유효 카테고리만 수용(무효면 메시지 후 무시).
  const startPick = (validCats: string[], apply: (id: string) => void) => {
    if (!requestPick) return;
    requestPick((id) => {
      const c = catOf(id);
      if (validCats.length && c && !validCats.includes(c)) {
        setMsg(`✗ 대상은 ${validCats.join("/")} 만 가능 (선택: ${c})`);
        return;
      }
      apply(id);
    });
  };

  return (
    <div className="action-block">
      <h4>관계 (엣지) 편집</h4>

      {picking && (
        <div className="pick-banner">
          좌측 그래프에서 <b>연결할 노드를 클릭</b>하세요.
          <button className="x" onClick={() => cancelPick?.()}>취소</button>
        </div>
      )}

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
                  title="타입 변경 (유효한 관계만)"
                >
                  {relOptionsFor(a).map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <span className="rel-arrow">{a.dir === "out" ? "→" : "←"}</span>
                <NodePicker
                  value={a.other}
                  nodes={nodes}
                  exclude={node.id}
                  filterCats={retargetCats(a)}
                  onChange={(far) => retarget(a, far)}
                />
                {requestPick && (
                  <button className="rel-pick" title="그래프에서 클릭해 재지정"
                    onClick={() => startPick(retargetCats(a), (id) => retarget(a, id))}>⊕</button>
                )}
                <button className="rel-del" title="삭제" onClick={() => del(a)}>삭제</button>
              </div>
            ))}
          </div>
        );
      })}

      <div className="rel-add">
        <div className="rel-title">관계 추가 (이 노드가 source)</div>
        {addableRels.length === 0 ? (
          <p className="muted">이 노드(<b>{node.category}</b>)는 관계의 시작점이 될 수 없습니다. (예: Property 는 has_property 의 대상)</p>
        ) : (
          <div className="rel-row">
            <select className="rel-type" value={addRel} onChange={(e) => { setAddRel(e.target.value); setAddTarget(""); }}>
              {addableRels.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <span className="rel-arrow">→</span>
            <NodePicker
              value={addTarget}
              nodes={nodes}
              exclude={node.id}
              filterCats={targetCatsFor(addRel)}
              onChange={setAddTarget}
              placeholder={`${targetCatsFor(addRel).join("/")} 노드 검색`}
            />
            {requestPick && (
              <button className="rel-pick" title="그래프에서 클릭해 선택"
                onClick={() => startPick(targetCatsFor(addRel), setAddTarget)}>⊕</button>
            )}
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
        )}
      </div>

      {msg && (
        <div className={msg.startsWith("✓") ? "result-ok" : msg.startsWith("⚠") ? "result-warn" : "result-bad"}>
          {msg}
        </div>
      )}
    </div>
  );
}
