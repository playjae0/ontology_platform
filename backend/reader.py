# -*- coding: utf-8 -*-
"""읽기 어댑터 (data source 은닉) — §3.4.

⚠️ 불변 원칙(§6.2/§3.3): 읽기 경로는 임베딩을 읽지도 저장하지도 않는다.
   ontology_agent.skeleton.Skeleton.load() 는 노드마다 embed()를 호출해
   BGE-M3(sentence-transformers)를 부팅하므로 절대 사용하지 않는다.
   여기서는 JSON을 직접 파싱하는 경량 read-model만 제공한다.

skeleton.json 실제 포맷(코드 우선, Skeleton.save 산출):
    {"nodes": {id: nodedict}, "edges": [edgedict]}
  (구버전/스펙 §2.2 의 list 형태도 관용적으로 수용한다.)
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Optional, Protocol

# 읽기 응답에서 절대 노출하지 않는 노드 필드 (§6.2)
_HIDDEN_NODE_FIELDS = {"embedding"}


def _strip(node: dict) -> dict:
    return {k: v for k, v in node.items() if k not in _HIDDEN_NODE_FIELDS}


class GraphReader(Protocol):
    def status(self) -> dict: ...
    def graph(self, scope_id: Optional[str]) -> dict: ...
    def node(self, node_id: str) -> Optional[dict]: ...
    def chunks_for_node(self, node_id: str) -> list: ...


class JsonReader:
    """JSON 파일을 SSOT로 직독하는 읽기 어댑터 (지금)."""

    def __init__(self, data_dir: str | Path):
        self.data_dir = Path(data_dir)
        self.skeleton_path = self.data_dir / "assembly_skeleton.json"
        self.contents_path = self.data_dir / "contents.json"

    # ---- 로딩 (매 요청 직독: 단일유저 슬라이스엔 충분, 항상 최신 SSOT 반영) ----
    def _load_skeleton(self) -> dict:
        if not self.skeleton_path.exists():
            return {"nodes": {}, "edges": []}
        d = json.loads(self.skeleton_path.read_text(encoding="utf-8"))
        nodes = d.get("nodes", {})
        if isinstance(nodes, list):                  # 관용: list → id-키 dict 정규화
            nodes = {n["id"]: n for n in nodes}
        return {"nodes": nodes, "edges": d.get("edges", [])}

    def _load_contents(self) -> dict:
        if not self.contents_path.exists():
            return {"chunks": [], "describes": []}
        d = json.loads(self.contents_path.read_text(encoding="utf-8"))
        return {"chunks": d.get("chunks", []), "describes": d.get("describes", [])}

    # ---- 공개 API ----
    def status(self) -> dict:
        sk = self._load_skeleton()
        ct = self._load_contents()
        by_cat: dict[str, int] = {}
        by_status: dict[str, int] = {}
        for n in sk["nodes"].values():
            by_cat[n.get("category", "?")] = by_cat.get(n.get("category", "?"), 0) + 1
            by_status[n.get("status", "?")] = by_status.get(n.get("status", "?"), 0) + 1
        return {
            # 데이터 존재 기준(파일경로 비의존) → Neo4jReader 등 비-파일 백엔드도 동일 동작
            "skeleton_loaded": len(sk["nodes"]) > 0,
            "contents_loaded": len(ct["chunks"]) > 0 or len(ct["describes"]) > 0,
            "counts": {
                "nodes": len(sk["nodes"]),
                "edges": len(sk["edges"]),
                "chunks": len(ct["chunks"]),
                "describes": len(ct["describes"]),
            },
            "nodes_by_category": by_cat,
            "nodes_by_status": by_status,
        }

    def graph(self, scope_id: Optional[str] = None) -> dict:
        """NVL 포맷 {nodes, rels} 반환. scope_id 주어지면 그 노드의 서브트리.

        서브트리 = scope 자신 + part_of/has_property 로 매달린 후손(설비/인자) +
        그 안에서의 precedes 순서 엣지.
        """
        sk = self._load_skeleton()
        nodes, edges = sk["nodes"], sk["edges"]

        if scope_id is None:
            keep = set(nodes.keys())
        else:
            keep = self._descendants(scope_id, edges)

        nvl_nodes = []
        for nid in keep:
            n = nodes.get(nid)
            if n is None:
                continue
            nvl_nodes.append(self._to_nvl_node(n))

        nvl_rels = []
        for i, e in enumerate(edges):
            if e["source"] in keep and e["target"] in keep:
                nvl_rels.append({
                    "id": f"e{i}",
                    "from": e["source"],
                    "to": e["target"],
                    "caption": e["relation"],
                    "relation": e["relation"],
                    "status": e.get("status", "proposed"),
                })
        return {"nodes": nvl_nodes, "rels": nvl_rels}

    def node(self, node_id: str) -> Optional[dict]:
        sk = self._load_skeleton()
        n = sk["nodes"].get(node_id)
        if n is None:
            return None
        detail = _strip(n)
        # 인접관계 요약
        adj = []
        for e in sk["edges"]:
            if e["source"] == node_id:
                adj.append({"dir": "out", "relation": e["relation"], "other": e["target"],
                            "other_name": self._name(sk, e["target"]), "status": e.get("status")})
            elif e["target"] == node_id:
                adj.append({"dir": "in", "relation": e["relation"], "other": e["source"],
                            "other_name": self._name(sk, e["source"]), "status": e.get("status")})
        detail["adjacency"] = adj
        return detail

    def chunks_for_node(self, node_id: str) -> list:
        ct = self._load_contents()
        cids = {d["source"] for d in ct["describes"] if d["target"] == node_id}
        return [c for c in ct["chunks"] if c.get("cid") in cids]

    def chunk(self, cid: str) -> dict | None:
        ct = self._load_contents()
        return next((c for c in ct["chunks"] if c.get("cid") == cid), None)

    def retrieve(self, q: str, k: int = 5) -> dict:
        """검색(retrieval) — ①링킹(별칭 exact + 렉시컬 substring) ②탐색(part_of/has_property)
        ③수집(describes 청크). 임베딩 미사용·미로드(§6.2). 질문 표현을 alias 에 누적하지 않음(§6.6).
        미해소(링크 0)는 alias gap 으로 표시 — 임베딩 fallback 없음(경계: 사내 실 임베딩 확장).
        """
        sk = self._load_skeleton()
        ct = self._load_contents()
        nodes, edges = sk["nodes"], sk["edges"]
        chunks, describes = ct["chunks"], ct["describes"]
        ql = (q or "").lower()

        # ① 링킹: 노드 표면형(canonical_name + aliases)이 질문의 부분문자열인가
        linked: dict[str, str] = {}
        for nid, n in nodes.items():
            for surf in [n.get("canonical_name"), *(n.get("aliases") or [])]:
                if surf and surf.lower() in ql:
                    linked[nid] = surf
                    break

        # ② 탐색: 링크 노드의 서브트리(설비/인자) 따라 확장
        visited = set(linked)
        for nid in list(linked):
            visited |= self._descendants(nid, edges)

        # ③ 수집: describes 청크. 링크 노드 describe=2, 탐색 노드=1 가중 → 랭킹
        tgt_cids: dict[str, set] = {}
        for d in describes:
            tgt_cids.setdefault(d.get("target"), set()).add(d.get("source"))
        score: dict[str, int] = {}
        for nid in visited:
            w = 2 if nid in linked else 1
            for cid in tgt_cids.get(nid, set()):
                score[cid] = score.get(cid, 0) + w
        by_cid = {c.get("cid"): c for c in chunks}
        ranked = sorted(score, key=lambda c: (-score[c], c))
        out_chunks = [{"cid": c, "text": by_cid[c].get("text"), "section": by_cid[c].get("section"),
                       "doc_id": by_cid[c].get("doc_id"), "score": score[c]}
                      for c in ranked if c in by_cid]

        return {
            "query": q,
            "linked_nodes": [{"id": nid, "name": nodes[nid].get("canonical_name"),
                              "category": nodes[nid].get("category"), "matched": surf}
                             for nid, surf in linked.items()],
            "traversed": sorted(visited - set(linked)),
            "chunks": out_chunks[: max(k, 10)],
            "gap": len(linked) == 0,
        }

    def search_nodes(self, q: str, limit: int = 20) -> list:
        """노드 검색 — canonical_name + aliases + id 매치(부분/대소문자 무시).
        콤보박스 typeahead 용. 실데이터 수천 노드 대비 상위 limit 만 반환.
        랭킹: id 정확일치 → 이름 시작일치 → 별칭 시작일치 → 부분일치.
        """
        ql = (q or "").strip().lower()
        if not ql:
            return []
        sk = self._load_skeleton()
        hits = []
        for nid, n in sk["nodes"].items():
            name = (n.get("canonical_name") or "")
            aliases = n.get("aliases", []) or []
            hay = [nid.lower(), name.lower(), *[a.lower() for a in aliases]]
            if any(ql in h for h in hay):
                hits.append({"id": nid, "canonical_name": name,
                             "category": n.get("category"), "aliases": aliases})

        def score(r):
            if r["id"].lower() == ql:
                return 0
            if (r["canonical_name"] or "").lower().startswith(ql):
                return 1
            if any(a.lower().startswith(ql) for a in r["aliases"]):
                return 2
            return 3

        hits.sort(key=lambda r: (score(r), r["id"]))
        return hits[:limit]

    @staticmethod
    def _order_by_precedes(ids: list, edges: list) -> list:
        s = set(ids)
        nxt = {}
        for e in edges:
            if e.get("relation") == "precedes" and e.get("source") in s and e.get("target") in s:
                nxt[e["source"]] = e["target"]
        incoming = set(nxt.values())
        out, seen = [], set()
        for st in [i for i in ids if i not in incoming]:
            cur = st
            while cur in s and cur not in seen:
                seen.add(cur); out.append(cur); cur = nxt.get(cur)
        for i in ids:
            if i not in seen:
                out.append(i)
        return out

    def dashboard_stats(self) -> dict:
        """현 SSOT 집계(읽기 전용·임베딩 미로드). M6 대시보드용."""
        sk = self._load_skeleton()
        ct = self._load_contents()
        nodes, edges = sk["nodes"], sk["edges"]
        chunks, describes = ct["chunks"], ct["describes"]

        by_cat, by_status = {}, {}
        aliases_total = 0
        for n in nodes.values():
            by_cat[n.get("category", "?")] = by_cat.get(n.get("category", "?"), 0) + 1
            by_status[n.get("status", "?")] = by_status.get(n.get("status", "?"), 0) + 1
            aliases_total += len(n.get("aliases", []) or [])
        by_rel = {}
        for e in edges:
            by_rel[e.get("relation", "?")] = by_rel.get(e.get("relation", "?"), 0) + 1

        # describes target → cids
        tgt_cids: dict[str, set] = {}
        for d in describes:
            tgt_cids.setdefault(d.get("target"), set()).add(d.get("source"))

        # 공정별 커버리지 = 대공정(=part_of 부모를 가진 Process), precedes 순
        has_part_parent = {e["source"] for e in edges if e.get("relation") == "part_of"}
        procs = [nid for nid, n in nodes.items()
                 if n.get("category") == "Process" and nid in has_part_parent]
        procs = self._order_by_precedes(procs, edges)
        coverage = []
        for pid in procs:
            sub = self._descendants(pid, edges)
            cids = set()
            for t in sub:
                cids |= tgt_cids.get(t, set())
            coverage.append({"id": pid, "name": nodes[pid].get("canonical_name", pid),
                             "nodes": len(sub), "chunks": len(cids)})

        linked = {d.get("source") for d in describes}
        all_cids = {c.get("cid") for c in chunks}
        unlinked = all_cids - linked
        orphan_n = len(self.orphans())
        up_total = by_cat.get("Unit", 0) + by_cat.get("Property", 0)

        return {
            "scale": {
                "nodes": len(nodes), "edges": len(edges),
                "chunks": len(chunks), "describes": len(describes),
                "nodes_by_category": by_cat, "edges_by_relation": by_rel,
            },
            "status": by_status,
            "coverage": coverage,
            "dictionary": {"aliases_total": aliases_total},
            "health": {
                "unlinked_chunks": len(unlinked), "total_chunks": len(chunks),
                "unlinked_chunk_rate": round(len(unlinked) / len(chunks), 3) if chunks else 0.0,
                "orphan_nodes": orphan_n, "unit_property_total": up_total,
                "orphan_node_rate": round(orphan_n / up_total, 3) if up_total else 0.0,
            },
        }

    def orphans(self) -> list:
        """구조적으로 부모가 사라진 Unit/Property 노드(엣지 삭제 등으로 고아화).
        리뷰 큐에 '재연결 필요'로 표시된다(§M5 게이트3). approve 대상인 후보와 별개.
        """
        sk = self._load_skeleton()
        nodes, edges = sk["nodes"], sk["edges"]
        has_parent = set()
        for e in edges:
            if e.get("relation") == "part_of":
                has_parent.add(e.get("source"))
            elif e.get("relation") == "has_property":
                has_parent.add(e.get("target"))
        out = []
        for nid, n in nodes.items():
            if (n.get("category") in ("Unit", "Property")
                    and nid not in has_parent and not n.get("attached_to")):
                out.append({
                    "node_id": nid,
                    "kind": "orphan_unit" if n.get("category") == "Unit" else "orphan_factor",
                    "surface": n.get("canonical_name"),
                    "category": n.get("category"),
                })
        return out

    # ---- 내부 헬퍼 ----
    @staticmethod
    def _name(sk: dict, nid: str) -> str:
        n = sk["nodes"].get(nid)
        return n["canonical_name"] if n else nid

    @staticmethod
    def _to_nvl_node(n: dict) -> dict:
        return {
            "id": n["id"],
            "caption": n.get("canonical_name", n["id"]),
            "category": n.get("category", "?"),
            "status": n.get("status", "proposed"),
        }

    @staticmethod
    def _descendants(scope_id: str, edges: list) -> set[str]:
        """scope_id 아래로 part_of/has_property 후손을 모은다 (자신 포함)."""
        children: dict[str, list[str]] = {}
        for e in edges:
            if e["relation"] in ("part_of", "has_property"):
                # part_of: child -part_of-> parent  (자식이 source)
                # has_property: unit -has_property-> property (속성이 target)
                if e["relation"] == "part_of":
                    children.setdefault(e["target"], []).append(e["source"])
                else:
                    children.setdefault(e["source"], []).append(e["target"])
        keep = set()
        stack = [scope_id]
        while stack:
            cur = stack.pop()
            if cur in keep:
                continue
            keep.add(cur)
            stack.extend(children.get(cur, []))
        return keep
