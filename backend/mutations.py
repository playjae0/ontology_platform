# -*- coding: utf-8 -*-
"""M3 변이 — 검수/승인 + 노드 편집/별칭. (store 로 백업·재검증·롤백 커밋)

불변 원칙(§6):
  - id 불변·무의미(§6.1): 신규 id 는 max+1 로 mint(의미 없음), 기존 id 재발급/변경 없음.
  - 노드·엣지 생성은 승인 경로로만(§6.4): 생성 노드는 status=confirmed.
  - alias 비누적(§6.6): 자동 누적 없음. add_alias/흡수는 사용자 명시 액션일 때만.
  - merge / move(재부모) / delete 없음(§10): 본 모듈은 추가·필드수정·alias 만 한다.
"""
from __future__ import annotations

import re
from typing import Any

from validate import RELATIONS

ID_NUM = re.compile(r"N(\d+)")
EDITABLE_FIELDS = ("canonical_name", "definition", "spec", "status")
STATUSES = {"proposed", "confirmed"}


# ----------------------------------------------------------- skeleton 유틸
def _nodes_dict(skeleton: dict) -> dict:
    nodes = skeleton.get("nodes", {})
    if isinstance(nodes, list):
        nodes = {n["id"]: n for n in nodes}
    return nodes


def _next_id(nodes: dict) -> str:
    mx = 0
    for nid in nodes:
        m = ID_NUM.fullmatch(nid)
        if m:
            mx = max(mx, int(m.group(1)))
    return f"N{mx + 1:04d}"


def _name(nodes: dict, nid: str) -> str:
    n = nodes.get(nid)
    return n["canonical_name"] if n else nid


def _find_item(queue: dict, rid: str) -> dict | None:
    return next((it for it in queue.get("items", []) if it.get("rid") == rid), None)


# ----------------------------------------------------------- 승인 코어
def _apply_one(nodes: dict, edges: list, contents: dict,
               item: dict, attach: str | None) -> dict:
    """item 을 in-memory 상태에 반영. 반환 {ok, created_id?, msg} / {ok:False, error}."""
    kind = item["kind"]
    surface = item["surface"]
    doc_id = item.get("doc_id", "")
    prov = [{"doc_id": doc_id, "surface": surface}] if doc_id else []

    if kind == "orphan_chunk_link":
        if not attach or attach not in nodes:
            return {"ok": False, "error": f"부착 노드 미지정/없음: {attach!r}"}
        cid = (item.get("evidence_cids") or [None])[0]
        if not cid:
            return {"ok": False, "error": "연결할 청크(cid) 없음"}
        describes = contents.setdefault("describes", [])
        if not any(d.get("source") == cid and d.get("target") == attach for d in describes):
            describes.append({"source": cid, "target": attach})
        return {"ok": True, "msg": f"청크 {cid} → '{_name(nodes, attach)}' 연결"}

    # ---- 이벤트 층(M12): FailureMode/Cause materialize + causes/affects ----
    # 층 분리(§6): 구조 노드(Process/Unit/Property)는 수정 안 함 — affects/causes 는 resolve-only 참조.
    if kind in ("new_failuremode", "new_cause"):
        nidx = {}
        for _id, _n in nodes.items():
            for key in [_n.get("canonical_name"), *(_n.get("aliases") or [])]:
                if key:
                    nidx[key] = _id
        nid = _next_id(nodes)
        cat = "FailureMode" if kind == "new_failuremode" else "Cause"
        nodes[nid] = {"id": nid, "canonical_name": surface, "category": cat,
                      "definition": f"{surface} ({cat})", "aliases": [], "attached_to": None,
                      "spec": None, "status": "confirmed", "provenance": prov, "embedding": None}
        made = []
        if kind == "new_failuremode":
            for name in item.get("affects_names", []) or []:
                tgt = nidx.get(name)
                if tgt:  # 구조 노드를 *참조*만(affects) — 수정 없음
                    edges.append({"source": nid, "relation": "affects", "target": tgt,
                                  "evidence": "approved", "status": "confirmed", "provenance": []})
                    made.append(f"affects {name}")
        else:  # new_cause → causes FailureMode
            fm = nidx.get(item.get("causes_name"))
            if fm:
                edges.append({"source": nid, "relation": "causes", "target": fm,
                              "evidence": "approved", "status": "confirmed", "provenance": []})
                made.append(f"causes {item.get('causes_name')}")
        # 발생/근거 청크 → 신규 이벤트 노드 describes(resolve-only)
        describes = contents.setdefault("describes", [])
        for cid in item.get("evidence_cids", []) or []:
            if not any(d.get("source") == cid and d.get("target") == nid for d in describes):
                describes.append({"source": cid, "target": nid})
        return {"ok": True, "created_id": nid,
                "msg": f"{cat} '{surface}' ({', '.join(made) or '엣지 미해소'})"}

    # 설비/인자 후보 → 신규 노드 + 엣지 생성
    if not attach or attach not in nodes:
        return {"ok": False,
                "error": f"부착위치(attach_to) 필요/존재하지 않음: {attach!r} "
                         f"('부착위치 수정 후 승인' 필요)"}
    nid = _next_id(nodes)

    if kind in ("new_unit", "orphan_unit"):
        nodes[nid] = {
            "id": nid, "canonical_name": surface, "category": "Unit",
            "definition": f"{_name(nodes, attach)}의 설비", "aliases": [],
            "attached_to": attach, "spec": None, "status": "confirmed",
            "provenance": prov, "embedding": None,
        }
        edges.append({"source": nid, "relation": "part_of", "target": attach,
                      "evidence": "approved", "status": "confirmed", "provenance": []})
        return {"ok": True, "created_id": nid,
                "msg": f"Unit '{surface}' → part_of '{_name(nodes, attach)}'"}

    if kind in ("new_factor", "orphan_factor"):
        nodes[nid] = {
            "id": nid, "canonical_name": surface, "category": "Property",
            "definition": "", "aliases": [], "attached_to": attach,
            "spec": item.get("spec"), "status": "confirmed",
            "provenance": prov, "embedding": None,
        }
        edges.append({"source": attach, "relation": "has_property", "target": nid,
                      "evidence": "approved", "status": "confirmed", "provenance": []})
        return {"ok": True, "created_id": nid,
                "msg": f"Property '{surface}'(spec={item.get('spec')}) ← '{_name(nodes, attach)}'"}

    return {"ok": False, "error": f"알 수 없는 kind '{kind}'"}


# ----------------------------------------------------------- 공개 연산
def approve(store, rid: str, attach_to: str | None = None) -> dict:
    queue = store.load_queue()
    item = _find_item(queue, rid)
    if item is None:
        return {"ok": False, "error": f"리뷰 항목 '{rid}' 없음"}

    skeleton = store.load_skeleton()
    nodes = _nodes_dict(skeleton)
    edges = skeleton.setdefault("edges", [])
    contents = store.load_contents()

    res = _apply_one(nodes, edges, contents, item, attach_to or item.get("attach_to"))
    if not res["ok"]:
        return res

    skeleton["nodes"] = nodes
    queue["items"] = [it for it in queue["items"] if it.get("rid") != rid]
    commit = store.commit(skeleton=skeleton, contents=contents, queue=queue)
    if not commit["ok"]:
        return {"ok": False, **commit}
    return {"ok": True, "approved": [rid], **{k: v for k, v in res.items() if k != "ok"}}


def approve_batch(store, rids: list[str]) -> dict:
    queue = store.load_queue()
    skeleton = store.load_skeleton()
    nodes = _nodes_dict(skeleton)
    edges = skeleton.setdefault("edges", [])
    contents = store.load_contents()

    approved, skipped = [], []
    for rid in rids:
        item = _find_item(queue, rid)
        if item is None:
            skipped.append({"rid": rid, "reason": "항목 없음"})
            continue
        res = _apply_one(nodes, edges, contents, item, item.get("attach_to"))
        if res["ok"]:
            approved.append(rid)
        else:
            skipped.append({"rid": rid, "reason": res["error"]})

    if not approved:
        return {"ok": True, "approved": [], "skipped": skipped}

    skeleton["nodes"] = nodes
    queue["items"] = [it for it in queue["items"] if it.get("rid") not in approved]
    commit = store.commit(skeleton=skeleton, contents=contents, queue=queue)
    if not commit["ok"]:
        return {"ok": False, **commit}
    return {"ok": True, "approved": approved, "skipped": skipped}


def reject(store, rid: str) -> dict:
    queue = store.load_queue()
    if _find_item(queue, rid) is None:
        return {"ok": False, "error": f"리뷰 항목 '{rid}' 없음"}
    queue["items"] = [it for it in queue["items"] if it.get("rid") != rid]
    commit = store.commit(queue=queue)
    return {"ok": commit["ok"], "rejected": [rid], **{k: v for k, v in commit.items() if k != "ok"}}


def absorb(store, rid: str, target: str) -> dict:
    """리뷰 후보를 기존 노드(target)로 흡수 → 항목 제거. 근거(evidence) 보존(사용자 (A) 의도).
      (1) 후보 surface/aliases → 생존 노드 aliases 추가(명시적 액션 — §6.6 예외)
      (2) 후보 evidence cid 마다 describes{cid → 생존노드} 추가(중복 제거) — 근거 청크 보존
      (3) 후보를 큐에서 제거
    생존 노드는 confirmed → describes 무결성 통과. 전부 store.commit 경유.
    """
    queue = store.load_queue()
    item = _find_item(queue, rid)
    if item is None:
        return {"ok": False, "error": f"리뷰 항목 '{rid}' 없음"}
    skeleton = store.load_skeleton()
    nodes = _nodes_dict(skeleton)
    if target not in nodes:
        return {"ok": False, "error": f"대상 노드 '{target}' 없음"}
    contents = store.load_contents()

    # (1) surface + aliases → 생존 노드 aliases
    before = set(nodes[target].get("aliases", []))
    for s in [item.get("surface"), *(item.get("aliases") or [])]:
        _add_alias(nodes[target], s)
    added_aliases = len(set(nodes[target].get("aliases", [])) - before)

    # (2) evidence cid → describes(생존 노드), 중복 제거
    describes = contents.setdefault("describes", [])
    existing = {(d.get("source"), d.get("target")) for d in describes}
    linked = 0
    for cid in (item.get("evidence_cids") or []):
        if (cid, target) not in existing:
            describes.append({"source": cid, "target": target})
            existing.add((cid, target))
            linked += 1

    # (3) 큐에서 제거
    skeleton["nodes"] = nodes
    queue["items"] = [it for it in queue["items"] if it.get("rid") != rid]
    commit = store.commit(skeleton=skeleton, contents=contents, queue=queue)
    if not commit["ok"]:
        return {"ok": False, **commit}
    return {"ok": True, "absorbed": rid,
            "added_aliases": added_aliases, "linked_describes": linked,
            "msg": f"'{item['surface']}' → '{_name(nodes, target)}'({target}) 흡수 "
                   f"(alias +{added_aliases}, describes +{linked})"}


def edit_node(store, nid: str, fields: dict) -> dict:
    skeleton = store.load_skeleton()
    nodes = _nodes_dict(skeleton)
    n = nodes.get(nid)
    if n is None:
        return {"ok": False, "error": f"노드 '{nid}' 없음"}
    if "id" in fields and fields["id"] != nid:
        return {"ok": False, "error": "id 는 불변입니다(§6.1)"}
    for f in EDITABLE_FIELDS:
        if f not in fields:
            continue
        v = fields[f]
        if f == "canonical_name" and (not isinstance(v, str) or not v.strip()):
            return {"ok": False, "error": "canonical_name 은 비어있을 수 없음"}
        if f == "status" and v not in STATUSES:
            return {"ok": False, "error": f"status 허용값 아님: {v!r}"}
        n[f] = v
    skeleton["nodes"] = nodes
    commit = store.commit(skeleton=skeleton)
    if not commit["ok"]:
        return {"ok": False, **commit}
    return {"ok": True, "node": nid}


def alias_op(store, nid: str, op: str, alias: str) -> dict:
    skeleton = store.load_skeleton()
    nodes = _nodes_dict(skeleton)
    n = nodes.get(nid)
    if n is None:
        return {"ok": False, "error": f"노드 '{nid}' 없음"}
    if op == "add":
        _add_alias(n, alias)
    elif op == "remove":
        n["aliases"] = [a for a in n.get("aliases", []) if a != alias]
    else:
        return {"ok": False, "error": f"op 는 add|remove: {op!r}"}
    skeleton["nodes"] = nodes
    commit = store.commit(skeleton=skeleton)
    if not commit["ok"]:
        return {"ok": False, **commit}
    return {"ok": True, "node": nid, "aliases": n.get("aliases", [])}


def _add_alias(node: dict, surface: str) -> None:
    if not surface:
        return
    aliases = node.setdefault("aliases", [])
    if surface != node.get("canonical_name") and surface not in aliases:
        aliases.append(surface)


# ----------------------------------------------------------- 엣지 편집 (M5)
def _find_edge(edges: list, source: str, relation: str, target: str) -> int:
    for i, e in enumerate(edges):
        if (e.get("source"), e.get("relation"), e.get("target")) == (source, relation, target):
            return i
    return -1


def _dup_exists(edges: list, source: str, relation: str, target: str, skip: int = -1) -> bool:
    for i, e in enumerate(edges):
        if i == skip:
            continue
        if (e.get("source"), e.get("relation"), e.get("target")) == (source, relation, target):
            return True
    return False


def _resync_attached(nodes: dict, edges: list, affected: set[str]) -> None:
    """영향받은 노드의 attached_to 를 최종 엣지에서 재유도(§M5 가드레일).
    part_of: 노드가 source → 부모=target. has_property: 노드가 target → 소유=source.
    """
    for nid in affected:
        n = nodes.get(nid)
        if n is None:
            continue
        parent = None
        for e in edges:
            if e.get("relation") == "part_of" and e.get("source") == nid:
                parent = e.get("target")
                break
        if parent is None:
            for e in edges:
                if e.get("relation") == "has_property" and e.get("target") == nid:
                    parent = e.get("source")
                    break
        n["attached_to"] = parent


def _category_warning(nodes: dict, source: str, relation: str, target: str) -> str | None:
    sc = (nodes.get(source) or {}).get("category")
    tc = (nodes.get(target) or {}).get("category")
    if relation == "has_property" and not (sc in ("Unit", "Process") and tc == "Property"):
        return f"has_property 는 보통 Unit/Process→Property 입니다 (현재 {sc}→{tc})"
    if relation == "part_of" and not (sc in ("Unit", "Process") and tc == "Process"):
        return f"part_of 는 보통 하위→Process 입니다 (현재 {sc}→{tc})"
    if relation == "precedes" and not (sc == "Process" and tc == "Process"):
        return f"precedes 는 보통 Process→Process 입니다 (현재 {sc}→{tc})"
    if relation == "causes" and not (sc == "Cause" and tc == "FailureMode"):
        return f"causes 는 보통 Cause→FailureMode 입니다 (현재 {sc}→{tc})"
    if relation == "affects" and not (sc in ("FailureMode", "Cause") and tc in ("Property", "Unit", "Process")):
        return f"affects 는 보통 FailureMode/Cause→구조 입니다 (현재 {sc}→{tc})"
    return None


def edit_edge(store, op: str, source: str, relation: str, target: str,
              new_source: str | None = None, new_relation: str | None = None,
              new_target: str | None = None) -> dict:
    """엣지 add / delete / update(재지정·타입변경). 전부 store.commit 경유.

    노드 id 는 건드리지 않는다(§6.1). 변이 후 attached_to 동기화 + 전체 재검증/롤백.
    """
    skeleton = store.load_skeleton()
    nodes = _nodes_dict(skeleton)
    edges = skeleton.setdefault("edges", [])
    affected: set[str] = set()
    warning: str | None = None

    if op == "add":
        if relation not in RELATIONS:
            return {"ok": False, "error": f"relation 허용값 아님: {relation!r}"}
        if _dup_exists(edges, source, relation, target):
            return {"ok": False, "error": "중복 엣지(동일 source-relation-target)"}
        edges.append({"source": source, "relation": relation, "target": target,
                      "evidence": "manual", "status": "confirmed", "provenance": []})
        affected |= {source, target}
        warning = _category_warning(nodes, source, relation, target)

    elif op == "delete":
        idx = _find_edge(edges, source, relation, target)
        if idx < 0:
            return {"ok": False, "error": "대상 엣지 없음"}
        edges.pop(idx)
        affected |= {source, target}

    elif op == "update":
        idx = _find_edge(edges, source, relation, target)
        if idx < 0:
            return {"ok": False, "error": "대상 엣지 없음"}
        ns = new_source or source
        nr = new_relation or relation
        nt = new_target or target
        if nr not in RELATIONS:
            return {"ok": False, "error": f"relation 허용값 아님: {nr!r}"}
        if _dup_exists(edges, ns, nr, nt, skip=idx):
            return {"ok": False, "error": "중복 엣지(동일 source-relation-target)"}
        prov = edges[idx].get("provenance", [])
        edges[idx] = {"source": ns, "relation": nr, "target": nt,
                      "evidence": "manual", "status": "confirmed", "provenance": prov}
        affected |= {source, target, ns, nt}
        warning = _category_warning(nodes, ns, nr, nt)

    else:
        return {"ok": False, "error": f"알 수 없는 op '{op}' (add|delete|update)"}

    # attached_to 동기화 후 커밋(없는 노드 참조면 commit 검증에서 막혀 롤백)
    _resync_attached(nodes, edges, affected)
    skeleton["nodes"] = nodes
    commit = store.commit(skeleton=skeleton)
    if not commit["ok"]:
        return {"ok": False, **commit}
    return {"ok": True, "warning": warning}
