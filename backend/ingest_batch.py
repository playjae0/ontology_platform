# -*- coding: utf-8 -*-
"""인입 워크스페이스 — 배치 단계별 오케스트레이션 (M9).

스테이지 슬롯(M4) 위 *오케스트레이션만*. 검수(M3)·store·validate 재사용.
흐름(게이트): ①업로드 → ②파싱(per-doc) → ③뼈대(배치 공유, 후보→리뷰 큐) →
              ④검수/승인(M3, 공유 큐) → ⑤콘텐츠 연결(per-doc, Mode D).
- ②없이 ③ 불가 · ③(+검수) 없이 ⑤ 불가.
- 모든 채택 store.commit(백업·재검증·자동롤백). 업로드≠승인(§6.9): ③은 후보(proposed)까지만.
- 스테이지는 config 로 external 스왑; 기본은 MockStage(데모).
"""
from __future__ import annotations

import json

import stages

BATCH_FILE = "ingest_batch.json"


def _empty() -> dict:
    # 매 호출 새 구조(가변 기본값 공유 금지)
    return {"docs": [], "stage_skeleton": "none", "candidates": 0}


def _path(store):
    return store.current / BATCH_FILE


def load_batch(store) -> dict:
    p = _path(store)
    if not p.exists():
        return _empty()
    return json.loads(p.read_text(encoding="utf-8"))


def save_batch(store, b: dict) -> None:
    _path(store).write_text(json.dumps(b, ensure_ascii=False, indent=2), encoding="utf-8")


def reset(store) -> dict:
    save_batch(store, _empty())
    return {"ok": True, "batch": _empty()}


def upload_docs(store, names: list[str]) -> dict:
    b = load_batch(store)
    start = len(b["docs"])
    for i, name in enumerate(names):
        idx = start + i
        b["docs"].append({"doc_id": f"DOC{idx + 1:02d}", "name": name, "index": idx,
                          "parse": "none", "chunks": 0, "link": "none", "describes": 0, "orphans": 0})
    save_batch(store, b)
    return b


def _name_index(skeleton: dict) -> dict:
    """canonical_name + alias → id (Mode A/B·D 해소용)."""
    nodes = skeleton.get("nodes", {})
    if isinstance(nodes, list):
        nodes = {n["id"]: n for n in nodes}
    idx = {}
    for nid, n in nodes.items():
        for key in [n.get("canonical_name"), *(n.get("aliases", []) or [])]:
            if key:
                idx[key] = nid
    return idx


def _stage(store, slot: str):
    """config 가 external 이면 external, 아니면 MockStage(데모 기본)."""
    spec = store.load_stage_config().get(slot, "manual")
    if spec.startswith("external:"):
        return stages.parse_spec(spec, slot)
    return stages.MockStage(slot)


# ----------------------------------------------------- ② 파싱 (per-doc)
def run_parse(store) -> dict:
    b = load_batch(store)
    if not b["docs"]:
        return {"ok": False, "error": "①업로드된 문서 없음"}
    contents = store.load_contents()
    chunks = contents.setdefault("chunks", [])
    have = {c.get("cid") for c in chunks}
    st = _stage(store, "parser")
    for d in b["docs"]:
        if d["parse"] == "done":
            continue
        out = st.run({"doc_id": d["doc_id"], "index": d["index"]})
        added = 0
        for c in out.get("chunks", []):
            if c.get("cid") not in have:
                chunks.append(c)
                have.add(c.get("cid"))
                added += 1
        d["chunks"] = added
        d["parse"] = "done"
    commit = store.commit(contents=contents)
    if not commit["ok"]:
        return {"ok": False, **commit}
    save_batch(store, b)
    return {"ok": True, "batch": b}


# ----------------------------------------------------- ③ 뼈대 (배치 공유)
def run_skeleton(store) -> dict:
    b = load_batch(store)
    if not b["docs"] or any(d["parse"] != "done" for d in b["docs"]):
        return {"ok": False, "error": "②파싱 미완료 — ③뼈대 불가"}
    contents = store.load_contents()
    skeleton = store.load_skeleton()
    names = _name_index(skeleton)
    doc_ids = {d["doc_id"] for d in b["docs"]}
    batch_chunks = [c for c in contents["chunks"] if c.get("doc_id") in doc_ids]
    st = _stage(store, "skeleton")
    out = st.run({"chunks": batch_chunks, "names": names})

    queue = store.load_queue()
    have_surf = {it.get("surface") for it in queue["items"]}
    added = 0
    for cand in out.get("candidates", []):
        if cand.get("surface") in have_surf:
            continue
        attach_name = cand.pop("attach_name", None)
        cand["attach_to"] = names.get(attach_name) if attach_name else cand.get("attach_to")
        cand["from_batch"] = True
        cand["rid"] = f"BR{len(queue['items']) + 1:03d}"
        queue["items"].append(cand)
        have_surf.add(cand["surface"])
        added += 1
    commit = store.commit(queue=queue)
    if not commit["ok"]:
        return {"ok": False, **commit}
    b["stage_skeleton"] = "ran"
    b["candidates"] = added
    save_batch(store, b)
    return {"ok": True, "candidates": added, "batch": b}


# ----------------------------------------------------- 이벤트 인입 (Mode C, M12)
def run_event(store) -> dict:
    """이슈 doc → FailureMode/Cause 후보(리뷰 큐) + 발생/근거 청크(contents). 파싱 후 실행."""
    b = load_batch(store)
    if not b["docs"] or any(d["parse"] != "done" for d in b["docs"]):
        return {"ok": False, "error": "②파싱 미완료 — 이벤트 인입 불가"}
    contents = store.load_contents()
    chunks = contents.setdefault("chunks", [])
    have = {c.get("cid") for c in chunks}
    queue = store.load_queue()
    have_surf = {it.get("surface") for it in queue["items"]}
    st = _stage(store, "event")
    added = 0
    for d in b["docs"]:
        out = st.run({"doc_id": d["doc_id"], "index": d["index"]})
        for c in out.get("chunks", []):  # 발생/근거 청크(노드 아님)
            if c.get("cid") not in have:
                chunks.append(c)
                have.add(c.get("cid"))
        for cand in out.get("candidates", []):  # FailureMode/Cause 후보만
            if cand.get("surface") in have_surf:
                continue
            cand["from_batch"] = True
            cand["rid"] = f"BE{len(queue['items']) + 1:03d}"
            queue["items"].append(cand)
            have_surf.add(cand["surface"])
            added += 1
    commit = store.commit(contents=contents, queue=queue)
    if not commit["ok"]:
        return {"ok": False, **commit}
    b["stage_event"] = "ran"
    b["event_candidates"] = added
    save_batch(store, b)
    return {"ok": True, "candidates": added, "batch": b}


# ----------------------------------------------------- ⑤ 콘텐츠 연결 (per-doc)
def run_content(store) -> dict:
    b = load_batch(store)
    if b.get("stage_skeleton") != "ran":
        return {"ok": False, "error": "③뼈대 미실행 — ⑤ 불가"}
    queue = store.load_queue()
    if any(it.get("from_batch") for it in queue["items"]):
        return {"ok": False, "error": "③ 후보 검수 미완료 — ④승인/거부 후 ⑤ 가능"}
    contents = store.load_contents()
    skeleton = store.load_skeleton()
    names = _name_index(skeleton)
    describes = contents.setdefault("describes", [])
    have = {(d.get("source"), d.get("target")) for d in describes}
    st = _stage(store, "content")
    total_orphans = 0
    for d in b["docs"]:
        if d["link"] == "done":
            continue
        dchunks = [c for c in contents["chunks"] if c.get("doc_id") == d["doc_id"]]
        out = st.run({"chunks": dchunks, "names": names})
        nlink = 0
        for link in out.get("describes", []):
            key = (link.get("source"), link.get("target"))
            if key not in have:
                describes.append(link)
                have.add(key)
                nlink += 1
        d["describes"] = nlink
        d["orphans"] = len(out.get("orphans", []))
        d["link"] = "done"
        total_orphans += d["orphans"]
    commit = store.commit(contents=contents)
    if not commit["ok"]:
        return {"ok": False, **commit}
    save_batch(store, b)
    return {"ok": True, "orphans": total_orphans, "batch": b}


def doc_preview(store, doc_id: str) -> dict:
    contents = store.load_contents()
    chunks = [c for c in contents["chunks"] if c.get("doc_id") == doc_id]
    cids = {c.get("cid") for c in chunks}
    describes = [d for d in contents["describes"] if d.get("source") in cids]
    return {"doc_id": doc_id, "chunks": chunks, "describes": describes}
