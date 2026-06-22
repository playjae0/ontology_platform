# -*- coding: utf-8 -*-
"""온톨로지 관리소 — FastAPI 백엔드.
  M1: 읽기 경로(Explore).  M2: 수동 JSON 주입(검증·채택·롤백·리셋).

불변 원칙(§6):
  - 읽기 경로는 임베딩을 읽지도 저장하지도 않는다 → reader.JsonReader 만 사용.
  - sentence-transformers / ontology_agent.skeleton 을 import 하지 않는다.
  - 모든 쓰기는 JSON 파일에만(§6.3). Neo4j 직접쓰기/merge/move/delete/임베딩저장 없음.
  - 업로드 ≠ 승인(§6.9): 주입은 SSOT 로딩까지, proposed 는 M3 승인 대상으로 남는다.
실행:  uvicorn app:app --port 8077 --reload  (platform/backend 에서)
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

from pydantic import BaseModel

import ingest_batch
import mutations
import stages
from reader import JsonReader
from store import Store, STAGE_SLOTS, STAGE_TO_INGEST

# 데이터 루트(§8): current=SSOT / mock=원본 / _backup=스냅샷
DATA_ROOT = Path(os.environ.get(
    "ONTOLOGY_DATA_ROOT", Path(__file__).resolve().parents[1] / "data"))

# WebGL 렌더는 config 로(§3.5) — 프론트가 기동 시 참조
USE_WEBGL = os.environ.get("USE_WEBGL", "0") == "1"

app = FastAPI(title="온톨로지 관리소 API", version="0.2.0 (M2)")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

store = Store(DATA_ROOT)
reader = JsonReader(store.current)  # 읽기는 작업 SSOT(current) 직독

# ---- Neo4j 파생 캐시 (M7) — JSON=SSOT, Neo4j=재생성되는 읽기 전용 캐시(§6.3) ----
NEO4J_URI = os.environ.get("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.environ.get("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.environ.get("NEO4J_PASSWORD", "ontology123")
_neo4j: dict = {"driver": None, "reader": None, "active": False}


def _ensure_neo4j_driver():
    """드라이버 연결(실패 시 명확한 예외). 성공 시 캐시."""
    if _neo4j["driver"] is not None:
        return _neo4j["driver"]
    from neo4j import GraphDatabase  # 미설치/미가동이면 여기서 에러
    drv = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
    drv.verify_connectivity()
    _neo4j["driver"] = drv
    return drv


def _resync_neo4j():
    """SSOT 변경 후 Neo4j 재생성(active 일 때만). store.on_change 훅."""
    if not _neo4j["active"]:
        return
    import neo4j_sync
    drv = _ensure_neo4j_driver()
    neo4j_sync.sync_to_neo4j(drv, store.load_skeleton(), store.load_contents())


store.on_change = _resync_neo4j


def pick_reader(backend: str):
    """backend='neo4j' 면 Neo4jReader(미가동/실패 시 503). 그 외 JsonReader."""
    if backend == "neo4j":
        if not _neo4j["active"] or _neo4j["reader"] is None:
            raise HTTPException(503, "Neo4j 비활성 — POST /neo4j/sync 로 적재·활성화 필요.")
        return _neo4j["reader"]
    return reader


@app.get("/health")
def health():
    return {"ok": True, "data_root": str(DATA_ROOT), "use_webgl": USE_WEBGL,
            "neo4j_active": _neo4j["active"]}


@app.get("/config")
def config():
    # 프론트 렌더 설정(§3.5): disableWebGL 은 config 로 노출
    return {"render": {"disableWebGL": not USE_WEBGL, "renderer": "canvas"}}


# ----------------------------------------------------------------- 읽기(R)
@app.get("/data/status")
def data_status(backend: str = "json"):
    return {**pick_reader(backend).status(), **store.slots_status()}


@app.get("/graph")
def graph(scope: str | None = None, backend: str = "json"):
    return pick_reader(backend).graph(scope)


@app.get("/dashboard/stats")
def dashboard_stats(backend: str = "json"):
    """읽기 전용 현황 집계 (M6) — 현 SSOT(JsonReader, 임베딩 미로드) + 리뷰 큐."""
    base = pick_reader(backend).dashboard_stats()
    queue = store.load_queue()
    by_kind: dict[str, int] = {}
    for it in queue.get("items", []):
        by_kind[it["kind"]] = by_kind.get(it["kind"], 0) + 1
    base["review"] = {
        "queue_by_kind": by_kind,
        "queue_total": len(queue.get("items", [])),
        "orphans": base["health"]["orphan_nodes"],
    }
    return base


@app.get("/retrieve")
def retrieve(q: str = "", k: int = 5, backend: str = "json"):
    """검색 — 별칭+렉시컬 링킹 → 탐색 → describes 청크 수집. 임베딩 미사용(§6.2). 읽기 전용."""
    return pick_reader(backend).retrieve(q, k)


@app.get("/eval/golden")
def eval_golden():
    import json as _json
    p = DATA_ROOT / "golden_set.json"
    if not p.exists():
        return {"items": []}
    return _json.loads(p.read_text(encoding="utf-8"))


@app.post("/eval/run")
def eval_run(k: int = 5, backend: str = "json"):
    """골든셋 실행 — Recall@k / MRR / 패턴별 분해 / alias gap. 골든셋 고정·읽기 전용."""
    import json as _json
    rd = pick_reader(backend)
    p = DATA_ROOT / "golden_set.json"
    golden = _json.loads(p.read_text(encoding="utf-8")) if p.exists() else {"items": []}
    items, gaps = [], []
    by_pattern: dict[str, list] = {}
    recall_sum = rr_sum = 0.0
    for g in golden.get("items", []):
        res = rd.retrieve(g["question"], k)
        returned = [c["cid"] for c in res["chunks"]]
        topk = returned[:k]
        gold = g.get("gold_chunks", [])
        resolved = not res["gap"]
        if not resolved:
            gaps.append({"id": g["id"], "question": g["question"]})
        if gold:
            hit = [c for c in gold if c in topk]
            recall = len(hit) / len(gold)
            rank = next((i + 1 for i, c in enumerate(returned) if c in gold), 0)
        else:
            # gap 문항(정답 청크 없음): 미해소면 정답(recall=1), 무언가 링크되면 오탐(0)
            recall = 1.0 if not resolved else 0.0
            rank = 0
        rr = (1.0 / rank) if rank else 0.0
        recall_sum += recall
        rr_sum += rr
        by_pattern.setdefault(g["query_pattern"], []).append(recall)
        items.append({"id": g["id"], "question": g["question"], "pattern": g["query_pattern"],
                      "recall": round(recall, 3), "rank": rank, "resolved": resolved,
                      "returned": topk, "gold": gold})
    n = len(golden.get("items", [])) or 1
    summary = {
        "k": k, "n": len(golden.get("items", [])),
        "recall_at_k": round(recall_sum / n, 3),
        "mrr": round(rr_sum / n, 3),
        "by_pattern": {p: round(sum(v) / len(v), 3) for p, v in by_pattern.items()},
        "gaps": gaps,
    }
    return {"summary": summary, "items": items}


@app.get("/nodes/search")
def nodes_search(q: str = "", limit: int = 20):
    """콤보박스 typeahead — name/aliases/id 매치 상위 N개. (라우트 순서: {node_id} 보다 위)"""
    return reader.search_nodes(q, limit)


@app.get("/nodes/{node_id}")
def get_node(node_id: str, backend: str = "json"):
    n = pick_reader(backend).node(node_id)
    if n is None:
        raise HTTPException(404, f"node '{node_id}' not found")
    return n


@app.get("/nodes/{node_id}/chunks")
def node_chunks(node_id: str, backend: str = "json"):
    rd = pick_reader(backend)
    if rd.node(node_id) is None:
        raise HTTPException(404, f"node '{node_id}' not found")
    return rd.chunks_for_node(node_id)


# ----------------------------------------------- 문서관리 / 출처 (M13, 읽기 전용)
@app.get("/documents")
def documents(backend: str = "json"):
    return pick_reader(backend).documents()


@app.get("/documents/{doc_id}")
def document(doc_id: str, backend: str = "json"):
    return pick_reader(backend).document(doc_id)


@app.get("/nodes/{node_id}/provenance")
def node_provenance(node_id: str, backend: str = "json"):
    p = pick_reader(backend).node_provenance(node_id)
    if p is None:
        raise HTTPException(404, f"node '{node_id}' not found")
    return p


# --------------------------------------------------- 수동 주입 / 스테이지(W)
@app.post("/ingest/upload/{slot}")
async def ingest_upload(slot: str, request: Request, adopt: bool = False):
    """slot ∈ {chunks, skeleton, contents}. body=업로드 JSON.
    adopt=false: 검증만(dry-run, SSOT 불변). adopt=true: 검증+채택(replace).
    응답: {valid, errors:[{path,msg}], counts?, adopted, ssot_errors?, warning?}
    """
    try:
        data: Any = await request.json()
    except Exception:
        raise HTTPException(400, "본문이 유효한 JSON 이 아닙니다.")
    return store.upload(slot, data, adopt=adopt)


@app.post("/ingest/rollback")
def ingest_rollback():
    return store.rollback()


@app.post("/ingest/reset-mock")
def ingest_reset_mock():
    return store.reset_mock()


# ------------------------------------------- 인입 워크스페이스 배치 (M9)
@app.get("/ingest/batch")
def ingest_batch_get():
    return ingest_batch.load_batch(store)


class BatchUpload(BaseModel):
    names: list[str]


@app.post("/ingest/batch/upload")
def ingest_batch_upload(body: BatchUpload):
    return {"ok": True, "batch": ingest_batch.upload_docs(store, body.names)}


@app.post("/ingest/batch/run/{stage}")
def ingest_batch_run(stage: str):
    """stage ∈ {parse, skeleton, content}. 게이트 위반 시 400. 채택은 store.commit."""
    fn = {"parse": ingest_batch.run_parse, "skeleton": ingest_batch.run_skeleton,
          "content": ingest_batch.run_content, "event": ingest_batch.run_event}.get(stage)
    if fn is None:
        raise HTTPException(404, f"알 수 없는 배치 스테이지 '{stage}' (parse|skeleton|content|event)")
    r = fn(store)
    if not r.get("ok"):
        raise HTTPException(400, detail=r)
    return r


@app.post("/ingest/batch/reset")
def ingest_batch_reset():
    return ingest_batch.reset(store)


@app.get("/ingest/batch/doc/{doc_id}")
def ingest_batch_doc(doc_id: str):
    return ingest_batch.doc_preview(store, doc_id)


# ----------------------------------------------------- Neo4j 승격 (M7)
@app.get("/neo4j/status")
def neo4j_status():
    return {"active": _neo4j["active"], "uri": NEO4J_URI}


@app.post("/neo4j/sync")
def neo4j_sync_endpoint():
    """현 SSOT(JSON) → Neo4j 재생성·활성화. 연결/적재 실패 시 503(명확한 에러)."""
    import time
    import neo4j_sync
    try:
        drv = _ensure_neo4j_driver()
        t0 = time.perf_counter()
        counts = neo4j_sync.sync_to_neo4j(drv, store.load_skeleton(), store.load_contents())
    except Exception as e:
        _neo4j["active"] = False
        try:  # 끊긴 드라이버 폐기 → 다음 시도 시 재생성(컨테이너 재가동 대비)
            if _neo4j["driver"]:
                _neo4j["driver"].close()
        except Exception:
            pass
        _neo4j["driver"] = None
        raise HTTPException(503, f"Neo4j 연결/적재 실패: {e} (uri={NEO4J_URI}). JSON 백엔드로 계속 가능.")
    ms = round((time.perf_counter() - t0) * 1000, 1)
    _neo4j["reader"] = neo4j_sync.Neo4jReader(drv)
    _neo4j["active"] = True
    return {"ok": True, "synced": counts, "sync_ms": ms}


@app.post("/neo4j/deactivate")
def neo4j_deactivate():
    _neo4j["active"] = False
    return {"ok": True, "active": False}


@app.get("/stage/config")
def stage_config_get():
    return store.load_stage_config()


class StageConfigBody(BaseModel):
    parser: str | None = None
    skeleton: str | None = None
    content: str | None = None


@app.put("/stage/config")
def stage_config_put(body: StageConfigBody):
    cfg = store.load_stage_config()
    for slot, spec in body.model_dump().items():
        if spec is None:
            continue
        try:
            stages.parse_spec(spec)  # 스펙 파싱 가능성 검증
        except stages.StageError as e:
            raise HTTPException(400, f"slot '{slot}' 스펙 오류: {e}")
        cfg[slot] = spec
    return store.save_stage_config(cfg)


@app.post("/stage/run/{slot}")
async def stage_run(slot: str, request: Request):
    """슬롯의 설정된 Stage 실행 (§3.2/M4).
    manual → 400(수동 업로드 전용). external → subprocess 실행 후, 외부 출력은 *미신뢰* 이므로
    수동 업로드와 동일하게 validate + store.commit(백업·전체 재검증·자동롤백) 으로만 채택.
    """
    if slot not in STAGE_SLOTS:
        raise HTTPException(404, f"알 수 없는 스테이지 슬롯 '{slot}' ({STAGE_SLOTS})")
    spec = store.load_stage_config()[slot]
    try:
        stage = stages.parse_spec(spec)
    except stages.StageError as e:
        raise HTTPException(400, str(e))

    ingest_slot = STAGE_TO_INGEST[slot]
    if stage.kind == "manual":
        raise HTTPException(
            400, f"'{slot}' 슬롯은 manual(수동 업로드 전용) — "
                 f"/ingest/upload/{ingest_slot} 사용. 외부 실행은 config 로 external 설정.")

    try:
        input_data = await request.json()
    except Exception:
        input_data = {}

    try:
        output = stage.run(input_data)  # subprocess → 출력 JSON 회수
    except stages.StageError as e:
        raise HTTPException(422, detail={"ok": False, "stage_error": str(e)})

    # 외부 출력 채택 = 수동 업로드와 동일 게이트(validate + commit + 자동롤백)
    result = store.upload(ingest_slot, output, adopt=True)
    return {"slot": slot, "ingest_slot": ingest_slot, "spec": spec, **result}


# ------------------------------------------------ 검수·승인·편집 (W, M3)
@app.get("/review/queue")
def review_queue():
    """리뷰 큐 항목 + 근거 청크 원문(resolve) + 구조적 고아 노드(파생)."""
    queue = store.load_queue()
    items = []
    for it in queue.get("items", []):
        ev = [reader.chunk(cid) for cid in it.get("evidence_cids", [])]
        items.append({**it, "evidence": [c for c in ev if c]})
    return {"items": items, "orphans": reader.orphans()}


class ApproveBody(BaseModel):
    rid: str
    attach_to: str | None = None


class BatchBody(BaseModel):
    rids: list[str]


class RidBody(BaseModel):
    rid: str


class AbsorbBody(BaseModel):
    rid: str
    target: str


class EditBody(BaseModel):
    canonical_name: str | None = None
    definition: str | None = None
    spec: str | None = None
    status: str | None = None


class AliasBody(BaseModel):
    op: str  # add | remove
    alias: str


def _result(r: dict):
    # 변이 실패(검증/롤백 등)는 422 로, 그 외 성공.
    if not r.get("ok", False):
        raise HTTPException(422, detail=r)
    return r


@app.post("/review/approve")
def review_approve(body: ApproveBody):
    return _result(mutations.approve(store, body.rid, body.attach_to))


@app.post("/review/approve-batch")
def review_approve_batch(body: BatchBody):
    return _result(mutations.approve_batch(store, body.rids))


@app.post("/review/reject")
def review_reject(body: RidBody):
    return _result(mutations.reject(store, body.rid))


@app.post("/review/absorb")
def review_absorb(body: AbsorbBody):
    return _result(mutations.absorb(store, body.rid, body.target))


@app.post("/nodes/{node_id}/edit")
def node_edit(node_id: str, body: EditBody):
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    return _result(mutations.edit_node(store, node_id, fields))


@app.post("/nodes/{node_id}/alias")
def node_alias(node_id: str, body: AliasBody):
    return _result(mutations.alias_op(store, node_id, body.op, body.alias))


class EdgeBody(BaseModel):
    op: str                         # add | delete | update
    source: str
    relation: str
    target: str
    new_source: str | None = None
    new_relation: str | None = None
    new_target: str | None = None


@app.post("/edges/edit")
def edge_edit(body: EdgeBody):
    """엣지 add/delete/update(재지정·타입변경) — §M5. 전부 store.commit(백업·재검증·롤백).
    part_of 변이 시 attached_to 동기화. 노드 id 불변, merge/move(노드)/delete(노드) 없음.
    """
    return _result(mutations.edit_edge(
        store, body.op, body.source, body.relation, body.target,
        new_source=body.new_source, new_relation=body.new_relation,
        new_target=body.new_target))
