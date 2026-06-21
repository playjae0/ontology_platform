# -*- coding: utf-8 -*-
"""Neo4j 승격 (M7) — JSON(SSOT) → Neo4j 읽기 전용 파생 캐시.

★가드레일 §6.3: JSON = 단일 원천. Neo4j 는 JSON 에서 **재생성**되는 파생 캐시.
   Neo4j 직접쓰기 절대 없음. 쓰기는 store.commit(JSON) → 그 후 sync_to_neo4j 재생성.

Neo4jReader = JsonReader 의 백엔드만 교체(_load_skeleton/_load_contents 를 Cypher 로) →
모든 집계/조회 로직은 동일 코드 재사용 ⇒ JsonReader 와 동일 결과를 보장.
"""
from __future__ import annotations

import json
from typing import Any

from reader import JsonReader

CATEGORIES = {"Process", "Unit", "Property"}
REL_MAP = {"part_of": "PART_OF", "precedes": "PRECEDES", "has_property": "HAS_PROPERTY"}
REL_REV = {v: k for k, v in REL_MAP.items()}


def _nodes_dict(skeleton: dict) -> dict:
    nodes = skeleton.get("nodes", {})
    if isinstance(nodes, list):
        return {n["id"]: n for n in nodes}
    return nodes


def sync_to_neo4j(driver, skeleton: dict, contents: dict) -> dict:
    """현 SSOT 를 Neo4j 에 재생성(전량 교체). 라벨=category, 관계=relation."""
    nodes = _nodes_dict(skeleton)
    edges = skeleton.get("edges", [])
    chunks = contents.get("chunks", [])
    describes = contents.get("describes", [])

    # category/relation 별 행 그룹 (라벨/타입은 화이트리스트만 → 인젝션 차단)
    nodes_by_cat: dict[str, list] = {}
    for nid, n in nodes.items():
        cat = n.get("category")
        if cat not in CATEGORIES:
            continue
        nodes_by_cat.setdefault(cat, []).append({
            "id": nid,
            "props": {
                "id": nid,
                "name": n.get("canonical_name"),
                "status": n.get("status"),
                "definition": n.get("definition") or "",
                "spec": n.get("spec"),
                "attached_to": n.get("attached_to"),
                "aliases": n.get("aliases", []) or [],
                "provenance_json": json.dumps(n.get("provenance", []), ensure_ascii=False),
            },
        })

    edges_by_rel: dict[str, list] = {}
    for e in edges:
        rel = e.get("relation")
        if rel not in REL_MAP:
            continue
        edges_by_rel.setdefault(rel, []).append(
            {"source": e.get("source"), "target": e.get("target"), "status": e.get("status")})

    with driver.session() as s:
        s.run("MATCH (n) DETACH DELETE n")  # 파생 캐시 전량 재생성
        s.run("CREATE INDEX onode_id IF NOT EXISTS FOR (n:Onode) ON (n.id)")
        s.run("CREATE INDEX chunk_cid IF NOT EXISTS FOR (c:Chunk) ON (c.cid)")
        for cat, rows in nodes_by_cat.items():
            s.run(
                f"UNWIND $rows AS r MERGE (n:`{cat}`:Onode {{id:r.id}}) SET n += r.props",
                rows=rows)
        for rel, rows in edges_by_rel.items():
            rtype = REL_MAP[rel]
            s.run(
                f"UNWIND $rows AS r MATCH (a:Onode {{id:r.source}}), (b:Onode {{id:r.target}}) "
                f"MERGE (a)-[x:`{rtype}`]->(b) SET x.status = r.status",
                rows=rows)
        if chunks:
            s.run(
                "UNWIND $rows AS r MERGE (c:Chunk {cid:r.cid}) "
                "SET c.doc_id=r.doc_id, c.section=r.section, c.text=r.text",
                rows=[{"cid": c.get("cid"), "doc_id": c.get("doc_id", ""),
                       "section": c.get("section", ""), "text": c.get("text", "")} for c in chunks])
        if describes:
            s.run(
                "UNWIND $rows AS r MATCH (c:Chunk {cid:r.source}), (n:Onode {id:r.target}) "
                "MERGE (c)-[:DESCRIBES]->(n)",
                rows=[{"source": d.get("source"), "target": d.get("target")} for d in describes])

    return {"nodes": len(nodes), "edges": len(edges),
            "chunks": len(chunks), "describes": len(describes)}


class Neo4jReader(JsonReader):
    """JsonReader 의 데이터 소스만 Neo4j 로 교체. 집계/조회 로직은 전부 상속(동일 결과)."""

    def __init__(self, driver):
        self.driver = driver
        # 파일 경로 비사용 — status() 는 데이터 기준으로 동작(reader.py)

    def _load_skeleton(self) -> dict:
        with self.driver.session() as s:
            nrows = s.run(
                "MATCH (n:Onode) RETURN n.id AS id, "
                "[l IN labels(n) WHERE l <> 'Onode'][0] AS category, "
                "n.name AS name, n.status AS status, n.definition AS definition, "
                "n.spec AS spec, n.attached_to AS attached_to, n.aliases AS aliases, "
                "n.provenance_json AS provenance_json").data()
            erows = s.run(
                "MATCH (a:Onode)-[x]->(b:Onode) "
                "RETURN a.id AS source, type(x) AS rtype, b.id AS target, x.status AS status").data()
        nodes = {}
        for r in nrows:
            nodes[r["id"]] = {
                "id": r["id"], "canonical_name": r["name"], "category": r["category"],
                "definition": r["definition"] or "", "aliases": r["aliases"] or [],
                "attached_to": r["attached_to"], "spec": r["spec"], "status": r["status"],
                "provenance": json.loads(r["provenance_json"] or "[]"), "embedding": None,
            }
        edges = [{"source": r["source"], "relation": REL_REV.get(r["rtype"], r["rtype"].lower()),
                  "target": r["target"], "status": r["status"], "provenance": []} for r in erows]
        return {"nodes": nodes, "edges": edges}

    def _load_contents(self) -> dict:
        with self.driver.session() as s:
            crows = s.run(
                "MATCH (c:Chunk) RETURN c.cid AS cid, c.doc_id AS doc_id, "
                "c.section AS section, c.text AS text").data()
            drows = s.run(
                "MATCH (c:Chunk)-[:DESCRIBES]->(n:Onode) "
                "RETURN c.cid AS source, n.id AS target").data()
        chunks = [{"cid": r["cid"], "doc_id": r["doc_id"], "section": r["section"],
                   "text": r["text"], "meta": {}} for r in crows]
        describes = [{"source": r["source"], "target": r["target"]} for r in drows]
        return {"chunks": chunks, "describes": describes}
