# -*- coding: utf-8 -*-
"""검증 2층 (§7 M2) — 스키마 + 참조 무결성. 실패는 라인별 {path, msg}.

- validate_slot(slot, data): 업로드된 단일 slot 의 스키마 + slot 내부 참조 무결성.
- validate_ssot(skeleton, contents): 채택 후 현 SSOT 전체의 교차-slot 참조 무결성.

디버깅 가능한 에러가 곧 기능이다 → path 는 'edges[3].target' 처럼 구체적으로.
"""
from __future__ import annotations

import re
from typing import Any

CATEGORIES = {"Process", "Unit", "Property"}
RELATIONS = {"part_of", "precedes", "has_property"}
STATUSES = {"proposed", "confirmed"}
NODE_ID_RE = re.compile(r"^N\d{4,}$")
CID_RE = re.compile(r"^C\d{4,}$")

Error = dict[str, str]  # {"path": ..., "msg": ...}


def _err(errs: list[Error], path: str, msg: str) -> None:
    errs.append({"path": path, "msg": msg})


def _is_str(v: Any) -> bool:
    return isinstance(v, str)


# ---------------------------------------------------------------- skeleton
def _node_items(nodes: Any) -> list[tuple[str, Any]]:
    """nodes(dict|list) → [(ref, node)] 로 정규화. ref 는 에러 path 표기용."""
    if isinstance(nodes, dict):
        return [(f"nodes['{k}']", v) for k, v in nodes.items()]
    if isinstance(nodes, list):
        return [(f"nodes[{i}]", v) for i, v in enumerate(nodes)]
    return []


def _validate_skeleton(data: Any, errs: list[Error]) -> set[str]:
    """반환: 노드 id 집합(참조 검증용)."""
    ids: set[str] = set()
    if not isinstance(data, dict):
        _err(errs, "$", "최상위가 객체(object)가 아님")
        return ids
    nodes = data.get("nodes")
    if nodes is None:
        _err(errs, "nodes", "필수 키 없음")
    elif not isinstance(nodes, (dict, list)):
        _err(errs, "nodes", "dict 또는 list 여야 함")
    else:
        for ref, n in _node_items(nodes):
            if not isinstance(n, dict):
                _err(errs, ref, "노드가 객체가 아님")
                continue
            nid = n.get("id")
            if not _is_str(nid) or not NODE_ID_RE.match(nid or ""):
                _err(errs, f"{ref}.id", f"id 형식 위반(N#### 필요): {nid!r}")
            else:
                ids.add(nid)
                if isinstance(nodes, dict):
                    key = ref[ref.index("'") + 1 : ref.rindex("'")]
                    if key != nid:
                        _err(errs, f"{ref}.id", f"dict 키('{key}')와 id('{nid}') 불일치")
            if not _is_str(n.get("canonical_name")) or not n.get("canonical_name"):
                _err(errs, f"{ref}.canonical_name", "비어있지 않은 문자열 필요")
            cat = n.get("category")
            if cat not in CATEGORIES:
                _err(errs, f"{ref}.category", f"허용값 아님({sorted(CATEGORIES)}): {cat!r}")
            st = n.get("status")
            if st is not None and st not in STATUSES:
                _err(errs, f"{ref}.status", f"허용값 아님({sorted(STATUSES)}): {st!r}")
            if "aliases" in n and not isinstance(n["aliases"], list):
                _err(errs, f"{ref}.aliases", "list 여야 함")
            at = n.get("attached_to")
            if at is not None and not _is_str(at):
                _err(errs, f"{ref}.attached_to", "문자열 또는 null 이어야 함")

    edges = data.get("edges")
    if edges is None:
        _err(errs, "edges", "필수 키 없음")
    elif not isinstance(edges, list):
        _err(errs, "edges", "list 여야 함")
    else:
        for i, e in enumerate(edges):
            p = f"edges[{i}]"
            if not isinstance(e, dict):
                _err(errs, p, "엣지가 객체가 아님")
                continue
            for f in ("source", "target"):
                if not _is_str(e.get(f)):
                    _err(errs, f"{p}.{f}", "문자열 필요")
            rel = e.get("relation")
            if rel not in RELATIONS:
                _err(errs, f"{p}.relation", f"허용값 아님({sorted(RELATIONS)}): {rel!r}")
            st = e.get("status")
            if st is not None and st not in STATUSES:
                _err(errs, f"{p}.status", f"허용값 아님({sorted(STATUSES)}): {st!r}")

    # slot 내부 참조 무결성: 엣지/부착이 가리키는 노드가 존재하나
    if isinstance(edges, list):
        for i, e in enumerate(edges):
            if not isinstance(e, dict):
                continue
            for f in ("source", "target"):
                v = e.get(f)
                if _is_str(v) and v not in ids:
                    _err(errs, f"edges[{i}].{f}", f"존재하지 않는 노드 '{v}'")
    for ref, n in _node_items(nodes if isinstance(nodes, (dict, list)) else []):
        if isinstance(n, dict):
            at = n.get("attached_to")
            if _is_str(at) and at not in ids:
                _err(errs, f"{ref}.attached_to", f"존재하지 않는 노드 '{at}'")
    return ids


# ---------------------------------------------------------------- chunks (공용)
def _validate_chunk_list(chunks: Any, errs: list[Error], base: str) -> set[str]:
    cids: set[str] = set()
    if not isinstance(chunks, list):
        _err(errs, base, "list 여야 함")
        return cids
    for i, c in enumerate(chunks):
        p = f"{base}[{i}]"
        if not isinstance(c, dict):
            _err(errs, p, "청크가 객체가 아님")
            continue
        cid = c.get("cid")
        if not _is_str(cid) or not CID_RE.match(cid or ""):
            _err(errs, f"{p}.cid", f"cid 형식 위반(C#### 필요): {cid!r}")
        else:
            cids.add(cid)
        if not _is_str(c.get("text")):
            _err(errs, f"{p}.text", "문자열 필요")
    return cids


def _validate_chunks_doc(data: Any, errs: list[Error]) -> None:
    if not isinstance(data, dict):
        _err(errs, "$", "최상위가 객체가 아님")
        return
    if not _is_str(data.get("doc_id")):
        _err(errs, "doc_id", "문자열 필요")
    if "chunks" not in data:
        _err(errs, "chunks", "필수 키 없음")
    else:
        _validate_chunk_list(data.get("chunks"), errs, "chunks")


# ---------------------------------------------------------------- contents
def _validate_contents(data: Any, errs: list[Error]) -> None:
    if not isinstance(data, dict):
        _err(errs, "$", "최상위가 객체가 아님")
        return
    cids: set[str] = set()
    if "chunks" not in data:
        _err(errs, "chunks", "필수 키 없음")
    else:
        cids = _validate_chunk_list(data.get("chunks"), errs, "chunks")
    describes = data.get("describes")
    if describes is None:
        _err(errs, "describes", "필수 키 없음")
    elif not isinstance(describes, list):
        _err(errs, "describes", "list 여야 함")
    else:
        for i, d in enumerate(describes):
            p = f"describes[{i}]"
            if not isinstance(d, dict):
                _err(errs, p, "객체가 아님")
                continue
            src, tgt = d.get("source"), d.get("target")
            if not _is_str(src) or not CID_RE.match(src or ""):
                _err(errs, f"{p}.source", f"cid 형식 위반(C#### 필요): {src!r}")
            elif src not in cids:
                _err(errs, f"{p}.source", f"이 contents 의 청크에 없는 cid '{src}'")
            if not _is_str(tgt) or not NODE_ID_RE.match(tgt or ""):
                _err(errs, f"{p}.target", f"노드 id 형식 위반(N#### 필요): {tgt!r}")
            # describes.target ∈ skeleton 노드 = 교차-slot → validate_ssot 에서


# ---------------------------------------------------------------- 공개 API
def validate_slot(slot: str, data: Any) -> list[Error]:
    """업로드된 단일 slot 검증(스키마 + slot 내부 참조)."""
    errs: list[Error] = []
    if slot == "skeleton":
        _validate_skeleton(data, errs)
    elif slot == "contents":
        _validate_contents(data, errs)
    elif slot == "chunks":
        _validate_chunks_doc(data, errs)
    else:
        _err(errs, "slot", f"알 수 없는 slot '{slot}' (chunks|skeleton|contents)")
    return errs


def validate_ssot(skeleton: Any, contents: Any) -> list[Error]:
    """채택 후 현 SSOT 전체의 교차-slot 참조 무결성."""
    errs: list[Error] = []
    ids: set[str] = set()
    if isinstance(skeleton, dict):
        nodes = skeleton.get("nodes")
        for _ref, n in _node_items(nodes):
            if isinstance(n, dict) and _is_str(n.get("id")):
                ids.add(n["id"])
    if isinstance(contents, dict):
        for i, d in enumerate(contents.get("describes", []) or []):
            if isinstance(d, dict):
                tgt = d.get("target")
                if _is_str(tgt) and tgt not in ids:
                    _err(errs, f"describes[{i}].target",
                         f"skeleton 에 없는 노드 '{tgt}' (교차-slot)")
    return errs
