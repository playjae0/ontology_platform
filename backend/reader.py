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

    # ---- 문서관리(M13) — 읽기 전용·additive: 기존 chunks/describes/provenance 집계만 ----
    @staticmethod
    def _node_processes(nid: str, nodes: dict, edges: list, _seen=None) -> set:
        """노드 → 닿는 공정(Process) id 집합. 구조: attached_to 상향. 이벤트: affects/causes 따라."""
        _seen = _seen or set()
        if nid in _seen or nid not in nodes:
            return set()
        _seen.add(nid)
        n = nodes[nid]
        cat = n.get("category")
        if cat == "Process":
            return {nid}
        if cat in ("Unit", "Property"):
            at = n.get("attached_to")
            return JsonReader._node_processes(at, nodes, edges, _seen) if at else set()
        # 이벤트 층: FailureMode→affects 구조, Cause→causes FailureMode
        out = set()
        for e in edges:
            if e.get("source") != nid:
                continue
            if e.get("relation") in ("affects", "causes"):
                out |= JsonReader._node_processes(e.get("target"), nodes, edges, _seen)
        return out

    def _doc_index(self):
        sk = self._load_skeleton()
        ct = self._load_contents()
        nodes, edges = sk["nodes"], sk["edges"]
        chunks, describes = ct["chunks"], ct["describes"]
        chunk_targets: dict[str, list] = {}
        for d in describes:
            chunk_targets.setdefault(d.get("source"), []).append(d.get("target"))
        return nodes, edges, chunks, describes, chunk_targets

    def documents(self) -> list:
        nodes, edges, chunks, _describes, chunk_targets = self._doc_index()
        docs: dict[str, dict] = {}
        for c in chunks:
            doc = c.get("doc_id", "?")
            d = docs.setdefault(doc, {"doc_id": doc, "chunks": [], "sections": set(),
                                      "described": set()})
            d["chunks"].append(c.get("cid"))
            if c.get("section"):
                d["sections"].add(c.get("section"))
            for nid in chunk_targets.get(c.get("cid"), []):
                d["described"].add(nid)
        out = []
        for doc, d in docs.items():
            cats = {nodes[n].get("category") for n in d["described"] if n in nodes}
            procs = set()
            for n in d["described"]:
                procs |= self._node_processes(n, nodes, edges)
            struct = bool(cats & {"Process", "Unit", "Property"})
            event = bool(cats & {"FailureMode", "Cause"})
            out.append({
                "doc_id": doc,
                "chunk_count": len(d["chunks"]),
                "node_count": len(d["described"]),
                "processes": sorted(nodes[p].get("canonical_name", p) for p in procs if p in nodes),
                "layer": "both" if (struct and event) else "event" if event else "structure",
                "sections": sorted(d["sections"]),
            })
        return sorted(out, key=lambda x: x["doc_id"])

    def document(self, doc_id: str) -> dict:
        nodes, _edges, chunks, _describes, chunk_targets = self._doc_index()
        rows = []
        described = set()
        for c in chunks:
            if c.get("doc_id") != doc_id:
                continue
            tgts = []
            for nid in chunk_targets.get(c.get("cid"), []):
                described.add(nid)
                n = nodes.get(nid)
                tgts.append({"id": nid, "name": n.get("canonical_name") if n else nid,
                             "category": n.get("category") if n else "?"})
            rows.append({"cid": c.get("cid"), "section": c.get("section"),
                         "text": c.get("text"), "meta": c.get("meta", {}), "describes": tgts})
        footprint = [{"id": nid, "name": nodes[nid].get("canonical_name"),
                      "category": nodes[nid].get("category")} for nid in sorted(described) if nid in nodes]
        return {"doc_id": doc_id, "chunks": rows, "footprint": footprint}

    def node_provenance(self, node_id: str) -> dict | None:
        sk = self._load_skeleton()
        ct = self._load_contents()
        nodes = sk["nodes"]
        if node_id not in nodes:
            return None
        n = nodes[node_id]
        by_cid = {c.get("cid"): c for c in ct["chunks"]}
        cids = [d.get("source") for d in ct["describes"] if d.get("target") == node_id]
        from_chunks = []
        for cid in cids:
            c = by_cid.get(cid)
            if c:
                from_chunks.append({"cid": cid, "doc_id": c.get("doc_id"), "section": c.get("section"),
                                    "text": c.get("text"), "meta": c.get("meta", {})})
        return {
            "id": node_id, "name": n.get("canonical_name"), "category": n.get("category"),
            "describes_chunks": from_chunks,
            "provenance": n.get("provenance", []),  # node.provenance(doc_id, surface)
        }

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

        # ② 탐색: (a) 구조 서브트리(part_of/has_property) (b) 이벤트 causes/affects 양방향(M12)
        struct = set()
        for nid in list(linked):
            struct |= self._descendants(nid, edges)
        struct -= set(linked)
        ce_adj: dict[str, set] = {}
        for e in edges:
            if e.get("relation") in ("causes", "affects"):
                ce_adj.setdefault(e.get("source"), set()).add(e.get("target"))
                ce_adj.setdefault(e.get("target"), set()).add(e.get("source"))
        event = set()
        frontier = set(linked) | struct
        for _ in range(2):  # 2홉: Property→affects⁻¹→FailureMode→causes⁻¹→Cause
            nxt = set()
            for n in frontier:
                for nb in ce_adj.get(n, set()):
                    if nb not in linked and nb not in struct and nb not in event:
                        event.add(nb); nxt.add(nb)
            frontier = nxt

        # ③ 수집: describes 청크. 링크=3 · 구조탐색=2 · 이벤트탐색=1 가중 → 랭킹
        tgt_cids: dict[str, set] = {}
        for d in describes:
            tgt_cids.setdefault(d.get("target"), set()).add(d.get("source"))
        weight = {**{n: 3 for n in linked}, **{n: 2 for n in struct}, **{n: 1 for n in event}}
        visited = set(weight)
        score: dict[str, int] = {}
        for nid, w in weight.items():
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
