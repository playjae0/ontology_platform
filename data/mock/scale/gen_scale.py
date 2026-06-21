# -*- coding: utf-8 -*-
"""스케일 검증 fixture 생성 (~1000 노드) — §2 스키마 준수. 스케일 검증 전용.

실 1000노드는 사외 반출 불가 → 합성. backbone 6공정 아래 합성 Unit/Property 다수 +
청크/describes. 결정적(seed 고정)으로 재현 가능.
출력: 같은 디렉토리에 assembly_skeleton.json, contents.json.
실행: python3 gen_scale.py [units_per_proc] [props_per_unit]
"""
import json
import sys
from pathlib import Path

UNITS_PER_PROC = int(sys.argv[1]) if len(sys.argv) > 1 else 34
PROPS_PER_UNIT = int(sys.argv[2]) if len(sys.argv) > 2 else 4

BACKBONE = ["노칭", "스태킹", "탭용접", "패키징", "전해액주입", "실링"]

nodes: dict = {}
edges: list = []
chunks: list = []
describes: list = []

_nc = 0
_cc = 0


def nid():
    global _nc
    v = f"N{_nc:04d}"
    _nc += 1
    return v


def cid():
    global _cc
    _cc += 1
    return f"C{_cc:04d}"


def add_node(name, cat, attached_to=None, spec=None, status="confirmed", aliases=None):
    i = nid()
    nodes[i] = {
        "id": i, "canonical_name": name, "category": cat, "definition": f"{name} ({cat})",
        "aliases": aliases or [], "attached_to": attached_to, "spec": spec,
        "status": status, "provenance": [], "embedding": None,
    }
    return i


def add_edge(s, rel, t, status="confirmed"):
    edges.append({"source": s, "relation": rel, "target": t,
                  "evidence": "synthetic", "status": status, "provenance": []})


def add_chunk_for(node_id, text):
    c = cid()
    chunks.append({"cid": c, "doc_id": "SCALE", "section": f"합성 §{c}", "text": text, "meta": {}})
    describes.append({"source": c, "target": node_id})


# 루트 + 6 대공정
root = add_node("조립공정", "Process", aliases=["assembly"])
proc_ids = []
prev = None
for name in BACKBONE:
    p = add_node(name, "Process", attached_to=root)
    add_edge(p, "part_of", root)
    if prev:
        add_edge(prev, "precedes", p)
    proc_ids.append(p)
    prev = p

# 각 공정 아래 합성 Unit/Property
for pi, p in enumerate(proc_ids):
    pname = BACKBONE[pi]
    for u in range(UNITS_PER_PROC):
        st = "proposed" if (u % 7 == 0) else "confirmed"
        unit = add_node(f"{pname}설비{u + 1:02d}", "Unit", attached_to=p, status=st,
                        aliases=[f"{pname}-U{u + 1}"])
        add_edge(unit, "part_of", p, status=st)
        # 일부 설비에만 근거 청크(커버리지 차등 → 대시보드와 동일 의미)
        if u % 3 == 0:
            add_chunk_for(unit, f"{pname} 공정의 {u + 1}번 설비는 합성 사양으로 동작한다.")
        for f in range(PROPS_PER_UNIT):
            pst = "proposed" if (f % 5 == 0) else "confirmed"
            prop = add_node(f"{pname}인자{u + 1:02d}-{f + 1}", "Property",
                            attached_to=unit, spec=f"±{(f + 1) * 5}%", status=pst)
            add_edge(unit, "has_property", prop, status=pst)
            if (u + f) % 9 == 0:
                add_chunk_for(prop, f"{pname} 인자 {u + 1}-{f + 1}는 ±{(f + 1) * 5}% 관리한다.")

out = Path(__file__).parent
(out / "assembly_skeleton.json").write_text(
    json.dumps({"nodes": nodes, "edges": edges}, ensure_ascii=False, indent=1), encoding="utf-8")
(out / "contents.json").write_text(
    json.dumps({"chunks": chunks, "describes": describes}, ensure_ascii=False, indent=1), encoding="utf-8")

print(f"nodes={len(nodes)} edges={len(edges)} chunks={len(chunks)} describes={len(describes)}")
print(f"  → {out}/assembly_skeleton.json, contents.json")
