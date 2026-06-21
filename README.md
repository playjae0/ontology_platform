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
- **M4 — 플러그형 스테이지 슬롯(외부 실행 배선)** ✅ 검증 통과
- **M6 — 대시보드(읽기 전용 현황)** ✅ 검증 통과
- **M7 — Neo4j 승격 + 1000-노드 스케일 검증** ✅ 검증 통과
- **M8 — 렌더-at-scale(확장형 스코핑 + 레이아웃 분기 + WebGL config)** ✅ 검증 통과
- **M9 — 인입 워크스페이스(배치 단계별 흐름)** ✅ 검증 통과
- **M10 — mock 6공정 확장(eval·데모용, 26노드)** ✅ 검증 통과
- **M11 — 검색(retrieval) + Eval(골든셋 Recall@k·MRR)** ✅ 검증 통과
- **M12 — 이벤트 층 스캐폴드(FailureMode/Cause + Mode C + 추적질의)** ✅ 검증 통과 — 3개 층 완성

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
| GET | `/dashboard/stats` | 현황 집계 (M6) — 규모·status·공정 커버리지·리뷰큐·alias·건강지표. 읽기 전용·임베딩 미로드 |
| GET | `/retrieve?q=&k=` | 검색 (M11) — 별칭+렉시컬 링킹→part_of/has_property 탐색→describes 청크. **임베딩-free**, 미해소=alias gap |
| GET/POST | `/eval/golden` · `/eval/run?k=` | 골든셋 / 평가 실행 (M11) — Recall@k·MRR·패턴분해·gap. 골든셋 고정 |
| GET | 위 읽기 엔드포인트 `?backend=json\|neo4j` | M7 — 백엔드 선택(기본 json). neo4j 비활성 시 503 |
| POST | `/neo4j/sync` · `/neo4j/deactivate` / GET `/neo4j/status` | M7 — JSON→Neo4j 재생성·활성화. **직접쓰기 엔드포인트 없음(§6.3)** |

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

### 인입 워크스페이스 (M9)
문서를 넣으면 플랫폼이 json까지 만드는 통합 인입 페이지. 배치(여러 문서) 단계별 진행 — 스테이지 슬롯(M4) 위 오케스트레이션, 검수(M3)·store·validate 재사용.

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET/POST | `/ingest/batch` · `/ingest/batch/upload` · `/ingest/batch/reset` | 배치 상태 / N문서 업로드 / 초기화 |
| POST | `/ingest/batch/run/{stage}` | `stage∈{parse,skeleton,content,event}`. 게이트 위반 시 400. `event`=Mode C(이벤트 인입, M12) |
| GET | `/ingest/batch/doc/{doc_id}` | 문서별 청크 + describes 미리보기 |

흐름: ①업로드(N문서)→②파싱(문서별)→③뼈대(배치 공유, 후보→리뷰 큐)→④검수/승인(M3 Workbench 핸드오프)→⑤콘텐츠 연결(문서별, 미해소=orphan). **②없이 ③ 불가, ③(+검수) 없이 ⑤ 불가.** 채택은 store.commit, **업로드≠승인**(③은 후보까지, 노드는 ④에서 materialize). 데모는 [MockStage](backend/stages.py)(결정적 샘플), 사내 코드는 config 로 `external` 스왑.

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
node verify_m6.mjs    # M6: 대시보드 집계 정확·탭 렌더·공정 커버리지 → m6_dashboard.png
node verify_m7_neo4j.mjs # M7: 1000-fixture json==neo4j 동일·응답시간·렌더관찰·변이반영 → m7_scale_render.png
node verify_backend_toggle.mjs # 진단: JSON⇄Neo4j 토글·응답시간·미가동 fallback (docker stop/start 포함)
node verify_m8.mjs    # M8: 확장형 스코핑(ego)·레이아웃 분기(force)·WebGL 토글 → m8_ego.png
node verify_m9_ingest.mjs # M9: 인입 배치 ①~⑤ 흐름·게이트·per-doc describes/orphan → m9_ingest.png
node verify_m10_mock.mjs  # M10: mock 6공정 확장(커버리지 빨강0·unlinked개선·동의어·전화면) → m10_dashboard.png
node verify_m11_eval.mjs  # M11: 검색→gold·Recall@k/MRR·패턴분해·alias gap·§6.6/§6.2 → m11_eval.png
node verify_m12_event.mjs # M12: 이벤트 스키마·Mode C·추적질의(causes/affects 역추적)·층분리 → m12_event.png
```

### 이벤트 층 (M12 — PFMEA 역추적)
3번째 층: `Cause --causes--> FailureMode --affects--> 구조(Property/Unit/Process)`. 발생/이력은 노드가 아니라 청크(meta date/line/lot) → `describes` FailureMode. **층 분리**: Mode C(이슈 인입)는 구조 노드를 *수정 못 하고* resolve-only로 참조만, 새 노드는 FailureMode/Cause만 승인 게이트로. 추적 질의 `/retrieve`가 causes/affects를 양방향 탐색 — "버발생 원인?"→금형마모(Cause)+책임 인자/설비(affects)+이슈청크. Explore/대시보드에 FailureMode(빨강)/Cause(보라) 층 가시화.

### 검색 + Eval (M11)
검색 = 질문 → 별칭+렉시컬 링킹 → part_of/has_property 탐색 → describes 청크 수집. **임베딩 불필요** — mock 에서도 Recall 의미있음(부수효과: "온톨로지에 질문하기"). 미해소는 `alias gap`으로 표시(임베딩-보강은 사내 실 임베딩 확장 경계). 골든셋 `data/golden_set.json`(21문항·4패턴, gold=실 mock cid). Test/Eval 탭에서 [평가 실행]→Recall@k·MRR·패턴별 집계·gap 목록.

mock baseline(M10): **26노드**(Process 7·Unit 7·Property 12), 청크 14, describes 19 — 6공정 모두 Unit/Property/청크 보유. `data/mock/` 갱신 후 `reset-mock` 으로 작업 SSOT에 시드.

**렌더-at-scale (M8)**: 스코프가 클 때(>60노드) Explore는 flat 덤프 대신 **확장형 보기**(포커스+이웃 ~50노드, 클릭으로 확장)로 렌더한다. [전체 평면 보기]로 NVL force 레이아웃 전환, 노드 수에 따라 Canvas/WebGL 토글.

Explore/대시보드 상단의 **[JSON ⇄ Neo4j] 토글**로 같은 화면에서 백엔드를 바꿔가며 응답시간(ms)을 비교할 수 있다(읽기 전용). Neo4j 미가동 시 토글이 비활성되고 JSON으로 동작한다.

### Neo4j (M7) 셋업
JSON = SSOT, Neo4j = JSON에서 재생성되는 **읽기 전용 파생 캐시**(§6.3, 직접쓰기 없음).
```bash
# docker (colima 등)에서 Neo4j 5-community
docker run -d --name onto-neo4j -p 7474:7474 -p 7687:7687 \
  -e NEO4J_AUTH=neo4j/ontology123 neo4j:5-community
pip install --break-system-packages neo4j      # 파이썬 드라이버
# 연결정보 override: NEO4J_URI(bolt://localhost:7687)·NEO4J_USER·NEO4J_PASSWORD
curl -X POST localhost:8077/neo4j/sync          # 현 SSOT 적재·활성화
# 이후 읽기: /graph?backend=neo4j 등. SSOT 변경 시 자동 재생성.

# 1000-노드 스케일 fixture 생성
python3 data/mock/scale/gen_scale.py            # → data/mock/scale/*.json
```
각 스크립트는 통과 시 exit 0.
