# 온톨로지 관리소 (관리 콘솔) — 슬라이스 빌드

2차전지 제조 온톨로지의 도메인 전문가용 관리 콘솔. **JSON 계약(contract) 기반** — 외부 파이프라인
구현 코드 없이 mock JSON + 수동 주입으로 전 기능을 짓고 검증한다. (스펙: 상위 `CLAUDE.md`)

## 구조
```
platform/
  backend/         FastAPI 읽기/쓰기 API
    app.py         엔드포인트
    reader.py      JsonReader — JSON SSOT 직독(임베딩 미사용·미저장)
  frontend/        React + Vite + TS + TanStack Query + NVL
    src/
      api.ts       백엔드 클라이언트 + 타입
      theme.ts     카테고리/상태 시각 규칙
      layout.ts    결정적 계층 좌표(part_of/precedes/has_property)
      App.tsx      화면2 Explore (3-pane)
      components/  GraphCanvas(NVL) · NodePanel · LeftPanel
  data/mock/       SSOT — assembly_skeleton.json, contents.json
```

## 진행 상태 (밀스톤)
- **M1 — 계약 + Mock + Explore(읽기/NVL)** ✅ 검증 통과
- **M2 — 수동 JSON 주입** ✅ 검증 통과
- **M3 — 검수/승인/편집 Workbench** ✅ 검증 통과
- **M5 — 관계(엣지) 편집** ✅ 검증 통과
- **M4 — 플러그형 스테이지 슬롯(외부 실행 배선)** ✅ 검증 통과 — 첫 슬라이스 완성

## 데이터 디렉토리 (§8)
```
data/
  mock/      원본 mock (절대 안 씀; reset-mock 의 복원원)
  current/   작업 SSOT — 읽기/쓰기 대상 (최초 기동 시 mock 으로 시드)
  _backup/   채택 직전 스냅샷(타임스탬프). 직전 롤백 1단계.
```
런타임 상태(`current/`, `_backup/`)는 git 무시 — 기동 시 `mock/`에서 시드된다.
`ONTOLOGY_DATA_ROOT` 로 루트 override 가능.

## 실행
### 백엔드 (포트 8077)
```bash
pip install --break-system-packages fastapi uvicorn
cd platform/backend
uvicorn app:app --port 8077 --reload
# 데이터 디렉토리 override: ONTOLOGY_DATA_DIR=/path uvicorn app:app ...
```
읽기 경로는 sentence-transformers/임베딩을 로드하지 않는다(§6.2). `ontology_agent.skeleton.Skeleton.load()`
는 노드마다 BGE-M3 임베딩을 재계산하므로 읽기에 절대 사용하지 않는다.

### 프론트엔드 (포트 5173)
```bash
cd platform/frontend
npm install
npm run dev            # http://localhost:5173
# 백엔드 주소 override: VITE_API_BASE=http://host:port npm run dev
```

## API
### 읽기 (M1)
| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/health` · `/config` | 헬스 · 프론트 렌더 설정(disableWebGL) |
| GET | `/data/status` | 로드 상태 + 카운트 + slot 정보 + 백업 수 |
| GET | `/graph?scope={id}` | 그래프 `{nodes, rels}` (NVL 포맷). scope=서브트리 |
| GET | `/nodes/{id}` | 노드 상세(embedding 미포함) + 인접관계 |
| GET | `/nodes/{id}/chunks` | describes 청크 원문 |

### 수동 주입 (M2)
| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | `/ingest/upload/{slot}?adopt=` | `slot∈{chunks,skeleton,contents}`. body=JSON. `adopt=false` 검증만(dry-run), `adopt=true` 검증+채택(replace). 응답 `{valid, errors:[{path,msg}], counts?, adopted, ssot_errors?, warning?}` |
| POST | `/ingest/rollback` | 직전 백업으로 1단계 복원 |
| POST | `/ingest/reset-mock` | `data/mock/` 로 복원 |
| GET/PUT | `/stage/config` | 슬롯별 스테이지 스펙(`manual` \| `external:<cmd>`) 조회/설정 |
| POST | `/stage/run/{slot}` | 슬롯(`parser`\|`skeleton`\|`content`) 스테이지 실행 (M4) |

**검증 2층** (`validate.py`): ①스키마(필드/타입/열거값 category·relation·status / id 형식 N####·C####) ②참조 무결성(`edges.source/target`∈nodes, `describes.source`∈chunks, `describes.target`∈skeleton nodes=교차-slot). 실패 시 라인별 `{path, msg}`.
**채택 = replace**(merge 없음). 채택 직후 SSOT 전체 재검증 → 깨지면 자동 롤백.
**업로드 ≠ 승인**(§6.9): 채택은 테스트/부트스트랩용 SSOT 로딩이며 `proposed` 노드는 M3 승인 대상으로 남는다.

### 검수/승인/편집 (M3)
리뷰 큐는 파이프라인 산출물(`data/mock/review_queue.json` → `current/`로 시드). 항목 종류: `new_unit`·`new_factor`·`orphan_unit`·`orphan_factor`·`orphan_chunk_link`. 근거 청크는 contents 의 evidence 청크를 cid 로 참조(describes 는 달지 않음 — 미존재 노드 참조 회피).

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/review/queue` | 리뷰 항목 + 근거 청크 원문(resolve) |
| POST | `/review/approve` | `{rid, attach_to?}` — 승인(materialize). attach_to 로 "부착위치 수정 후 승인" |
| POST | `/review/approve-batch` | `{rids:[...]}` — 일괄 승인(미부착 orphan 은 skip) |
| POST | `/review/reject` | `{rid}` — 제안 폐기 |
| POST | `/review/absorb` | `{rid, target}` — 후보를 기존 노드로 흡수: surface/aliases→alias 추가 **+ evidence cid→생존노드 describes(근거 보존)** + 후보 큐 제거 |
| POST | `/nodes/{id}/edit` | `{canonical_name?, definition?, spec?, status?}` — **id 불변** |
| POST | `/nodes/{id}/alias` | `{op: add\|remove, alias}` |

승인 = 노드/엣지 생성(§6.4, status=`confirmed`). 신규 id 는 `max+1` mint(무의미·§6.1). 모든 변이는 백업+SSOT 재검증+자동롤백(`store.commit`)으로 커밋. **노드 merge/delete 없음**(§10) — 해당 엔드포인트는 존재하지 않음(404).

### 관계(엣지) 편집 (M5)
| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | `/edges/edit` | `{op:add\|delete\|update, source, relation, target, new_source?, new_relation?, new_target?}` |

`update` = 재지정(new_source/new_target) 또는 타입 변경(new_relation). 가드레일: **part_of 변이 시 노드 `attached_to` 동기화**, 중복 엣지(동일 source-relation-target) 금지, 타입 변경 시 category sanity 경고(막지 않음), 없는 노드 참조는 `store.commit` 전체 재검증에서 막혀 자동 롤백. 엣지 삭제로 부모를 잃은 Unit/Property 는 `/review/queue` 의 `orphans` 로 파생 표시 → Workbench 에서 노드 선택 후 "관계 추가"로 재연결. UI: [NodeEditForm](frontend/src/components/NodeEditForm.tsx) 하단 [RelationEditor](frontend/src/components/RelationEditor.tsx).

**노드 선택 = 검색형 콤보박스** ([NodePicker](frontend/src/components/NodePicker.tsx)): `<select>` 대신 typeahead — `GET /nodes/search?q=`(canonical_name·aliases·id 매치, 상위 N개, 랭킹). 후보 "이름 (category · id)" 표시로 동명이인 구분, id 직접 입력/붙여넣기 지원(없는 id 거부). 관계 행은 target 노드를 주인공으로 한 grid 레이아웃.

### 플러그형 스테이지 슬롯 (M4)
스테이지(`parser`/`skeleton`/`content`)를 [stages.py](backend/stages.py)의 `Stage` 인터페이스로 추상화 — `ManualUploadStage`(수동 업로드 전용) / `ExternalScriptStage`(사내 스크립트 subprocess: `<cmd> <in.json> <out.json>`). 슬롯별 선택은 `data/stage_config.json` 또는 env `STAGE_<SLOT>`(`manual`|`external:<cmd>`), `GET/PUT /stage/config`로 관리. `POST /stage/run/{slot}`: manual→400(수동 전용), external→subprocess 실행 후 **외부 출력은 미신뢰 → validate + store.commit(백업·전체 재검증·자동롤백) 게이트로만 채택**. 비정상 종료/출력 없음/깨진 JSON → 422 + SSOT 불변. 화면1에 슬롯 config(external 배지 + 실행 버튼) 표시.

## 검증
헤드리스 브라우저 자동 검증 (백엔드 8077·dev서버 5173 기동 상태에서):
```bash
cd platform/frontend
node verify_m1.mjs    # Explore: NVL 렌더 + 노드 선택→상세/청크        → m1_explore.png
node verify_m2.mjs    # 데이터관리: 깨진업로드 거부 / 검증→채택→카운트 / 롤백 → m2_datamanage.png
node verify_m3.mjs    # Workbench: 큐 렌더 / 승인→그래프 반영 / 별칭흡수 / 일괄승인 → m3_workbench.png
node verify_m3_reconcile.mjs # M3 정합: 별칭 흡수 근거 보존(alias+describes), 무결성
node verify_edge_edit.mjs  # M5: 재지정·롤백·삭제→고아·재연결·중복·id불변·merge부재 → m5_relation_editor.png
node verify_node_picker.mjs # M5: 검색 콤보박스(필터·id직접·없는것거부·부모표시·재지정) → m5_node_picker.png
node verify_m4.mjs    # M4: echo 외부스테이지 실행→채택 / 깨진출력→거부·불변 / manual→400 → m4_stages.png
```
각 스크립트는 통과 시 exit 0.
