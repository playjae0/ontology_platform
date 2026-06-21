# CLAUDE.md — 온톨로지 관리 플랫폼(관리소) 빌드 스펙 · v3

> **진행 상태**: M1~M6 ✅ · **M7(Neo4j 승격 + 1000 스케일검증) ✅** — 첫 슬라이스 완성. 남은 비범위: Eval(골든셋)만.
> **이 문서는 빌드 명세다.** §7 밀스톤 순서대로, 각 밀스톤의 **검증 게이트를 통과한 뒤** 다음으로. 한 번에 전부 만들지 말 것.
> **§6 불변 원칙은 절대 위반 금지.** 충돌 시 멈추고 §6 우선, 그다음 사용자 확인.
> **사용법**: 이 파일은 레포 루트에 두면 Claude Code가 자동 로드한다. 밀스톤 착수는 짧은 포인터(예: "M3 진행, §7 따라가")로 충분 — 전체 재첨부 불필요.

### 변경 이력
- **v3.4a**: 백엔드 토글(JSON⇄Neo4j) + 응답시간 표시(진단) — Explore/대시보드 상단. `?backend=` 재사용, 읽기 전용. 미가동 시 토글 비활성+json fallback. `verify_backend_toggle.mjs`.
- **v3.4**: M7(Neo4j 승격) 추가·완료 — `Neo4jReader`(JsonReader 상속, Cypher 백엔드), `neo4j_sync`(JSON→Neo4j 재생성, label=category), `store.on_change` 훅(SSOT 변경 시 자동 재생성), 읽기 엔드포인트 `?backend=neo4j`. §10에서 "Neo4j 승격" 제거. §9에 1000-노드 스케일 fixture. **§6.3 재확인: Neo4j=읽기 전용 파생 캐시, 직접쓰기 절대 없음.**
- **v3.3**: M6(대시보드) 추가·완료 — 읽기 전용 현황(`GET /dashboard/stats`). §10에서 "대시보드" 제거(Eval·neo4j 등은 유지).
- **v3.2**: M4(스테이지 슬롯) 완료. **M3 정합**: as-built(별도 `review_queue.json`·후보 materialize·거부=후보 드롭)를 정본으로 §7 M3 재정렬, "SSOT 파생 큐" 폐기. 별칭 흡수에 **근거 보존**(evidence cid → 생존노드 describes) 추가.
- **v3.1**: M5(관계/엣지 편집) 추가·완료 — §7 M5, §5 `/edges/edit`·`/review/queue` orphans, §6.10에 part_of↔attached_to 동기화, §10에서 edge move/delete 제거(M5로 활성). store.commit 을 전체 검증(스키마+참조무결성)으로 강화.
- v3: M1·M2를 "DONE+핵심결정"으로 압축(불변 가드레일은 풀 유지). **§7 M3 풀 보강** + 별칭 흡수 = **(A) 풀 재지정**.
- v2: M1 완료·실측 정정(§2.2 nodes=dict, `attached_to`), §3.5 canvas/결정적 레이아웃 반영, M2 본체 상세화.

---

## 0. TL;DR
- **만들 것**: 2차전지 제조 온톨로지의 **도메인 전문가용 관리 콘솔**(그래프 시각화 + 노드 상세/근거 청크 + 검수·승인·편집).
- **결정적 제약**: 파이프라인 *구현 코드*(파싱·온톨로지 생성)는 외부 사내망 → 못 가져옴. 플랫폼은 **JSON 계약 기반**, 각 스테이지는 **플러그형 슬롯**(지금=수동 주입 / 나중=외부 스크립트 stub).
- **지금은 mock JSON + 수동 주입으로 전 기능 구축·검증.** 외부 코드·실데이터 의존 0.
- **단일 원천(SSOT) = JSON 파일.** Neo4j = JSON 에서 재생성되는 읽기 전용 파생 캐시(M7, 직접쓰기 없음). 시각화 = **NVL**, `disableTelemetry:true` 필수.

---

## 1. 시스템 컨텍스트
전체 = 저장소(graph) + 처리소(4단계 파이프라인) + **관리소(이 플랫폼)**. 처리소 스테이지는 서로 import 없이 **JSON 파일 계약**으로만 결합 → 플랫폼도 계약만 알고 구현은 슬롯으로 꽂는다.

| 스테이지 | 입력 → 출력 |
|---|---|
| ①파싱 | 문서 → `chunks.json` |
| ②뼈대(구조) | chunks → `assembly_skeleton.json` (Mode A/B + 승인) |
| ③콘텐츠 | chunks+뼈대 → `contents.json` (Mode D, resolve-only) |
| ④질의 | 위 둘 → GraphRAG (읽기) |

조립 backbone(시드 가정): 노칭→스태킹→탭용접→패키징→전해액주입→실링 (pouch cell).

---

## 2. 데이터 계약 (authoritative — 단일 기준은 레포 `common/models.py`)

**`chunks.json`**: `{doc_id, source, chunks:[{cid:"C0001", text, section, meta}]}`

**`assembly_skeleton.json`** — *M1 실측 확정*:
- 최상위 `nodes`는 **id-키 딕셔너리**(list 아님): `{"N0001": {…}}`. `JsonReader`는 list/dict 양쪽 수용.
- 노드: `id`(불변·무의미 N####), `canonical_name`, `category`(Process|Unit|Property), `definition`, `aliases`[], `spec`(Property용, 필드), `status`(proposed|confirmed), `provenance`, 부착 **`attached_to`**.
- 계층은 `attached_to` 및/또는 `edges`의 `part_of`로 표현. `edges`: `source`, `relation`(part_of|precedes|has_property), `target`, `status`, `provenance`.

**`contents.json`**: `{chunks:[…], describes:[{source:"C0007", target:"N0003"}]}`

**리뷰 큐 종류**: `new_unit`·`new_factor`·`orphan_unit`·`orphan_factor`·`orphan_chunk_link` (§7 M3에서 **SSOT 파생 계산**, 별도 파일 아님).

---

## 3. 아키텍처

**3.1 단일 원천/흐름**: 모든 쓰기는 **JSON 파일에만**. Neo4j 파생(범위 밖)·직접쓰기 엔드포인트 **없음**.

**3.2 플러그형 스테이지 어댑터**:
```python
class Stage(Protocol):
    def run(self, inputs: dict) -> dict: ...   # JSON-in → JSON-out
class ManualUploadStage: ...     # 지금
class ExternalScriptStage:        # 나중: 사내 스크립트 subprocess
    def __init__(self, cmd: list[str]): ...   # 지금은 stub
```
슬롯 `parser`/`skeleton`/`content` 기본 전부 `ManualUploadStage`. 외부 코드 도착 시 해당 슬롯만 교체. **구현 하드코딩 금지.**

**3.3 백엔드(FastAPI, `platform/backend/`)**: 기존 `common/` import 재사용. **읽기 경로는 JSON 직접 파싱 경량 read-model** — `Skeleton.load()` 류 금지(임베딩 재계산해 BGE-M3 부팅). `sentence-transformers` 없이 기동(M1 준수).

**3.4 읽기 어댑터**: `GraphReader` → `JsonReader`(기본) / `Neo4jReader`(M7, 구현됨). **Neo4jReader = JsonReader 의 데이터 소스만 Cypher 로 교체**(`_load_skeleton`/`_load_contents` override) → 집계/조회 로직 전부 상속 ⇒ JsonReader 와 동일 결과 보장. 프론트는 `GraphReader`만 본다(시그니처 불변); 읽기 엔드포인트 `?backend=json|neo4j`. **Neo4j 는 JSON 에서 재생성되는 읽기 전용 파생 캐시(§6.3)** — SSOT 변경 시 `store.on_change` 훅이 `neo4j_sync` 자동 재생성.

**3.5 프론트(React+Vite+TS, `platform/frontend/`)** — *M1 구현 반영*:
- `@neo4j-nvl/react`(+interaction-handlers). **`disableTelemetry:true` 필수.**
- 렌더 `renderer:"canvas"` + `disableWebGL:true`(헤드리스 회피+슬라이스 규모 충분). ⚠️ **config로 유지** — 대규모 시 WebGL 필요.
- 레이아웃: `layout.ts`에서 **결정적 계층 좌표** 직접 산출(part_of 계층/precedes 순서/has_property 부착)→`positions` 주입. ⚠️ 노드 대폭 증가 시 보강.
- 캔버스라 **노드 안 HTML 금지** — 상세·편집은 옆 패널.

---

## 4. 화면

**화면2 — Explore(읽기 전용) · DONE ✅**: 3-pane(좌 스코프·필터·검색 / 중앙 NVL 캔버스 / 우 노드 상세+describes 청크 원문+출처+인접관계). 상단 **백엔드 토글(JSON⇄Neo4j)+응답시간(ms) 표시**(진단, 대시보드도; `?backend=` 전환, 같은 데이터·차이는 속도뿐, 미가동 시 비활성+json fallback).

**화면1 — 데이터 관리+수동 주입 · DONE ✅**: SSOT 상태/slot 테이블, 3 slot 주입 카드(검증→채택은 valid 시만), 직전 롤백·mock 리셋, 스테이지 슬롯 표시. 업로드≠승인 명시.

**화면4 — 대시보드(읽기 전용) · DONE ✅**: 현 SSOT 집계 현황 — 규모(카테고리/관계별), 검수 status 분포, 공정별 커버리지(어느 공정이 비었나), 리뷰 큐 종류별+orphans, 동의어 사전 누적 alias(flywheel), 건강지표(unlinked 청크율·orphan율). 기존 read path 재사용, 쓰기 없음.

**화면3 — 검수/승인/편집 Workbench · M3 ★ (좌우 분할)**:
- **좌(½)**: NVL 그래프(현 스코프) + **proposed/고아 시각 플래그**(배지/하이라이트). 클릭→우측 로드.
- **우(½)**: **듀얼 모드 패널**
  - proposed/고아 선택 → **검수 모드**: 근거 청크 원문 + 4 액션
  - confirmed 노드 선택 → **편집 모드**: `canonical_name`(id 불변)·`definition`·`spec`·`aliases`·`status` 수정 → 저장
- **큐 워크리스트**: 대기 카운트 + prev/next 순회 + 다중선택 체크박스(일괄 승인용).
- 정확한 쓰기 시맨틱·검증 게이트는 §7 M3.

---

## 5. API 표면

**읽기(R) · DONE**: `GET /data/status` · `/graph?scope={id}`(NVL 포맷) · `/nodes/{id}`(**embedding 미포함**) · `/nodes/{id}/chunks` · `/nodes/search?q=` · `/review/queue` · `/dashboard/stats`(M6 집계). 읽기 엔드포인트는 `?backend=json|neo4j`(M7, 기본 json) 지원.

**Neo4j 승격(M7)**: `POST /neo4j/sync`(JSON→Neo4j 재생성·활성화) · `GET /neo4j/status` · `POST /neo4j/deactivate`. **Neo4j 직접쓰기 엔드포인트 없음(§6.3).**

**수동 주입/스테이지(W) · DONE**: `POST /ingest/upload/{slot}?adopt=`(검증↔채택 dry-run, `{valid, errors:[{path,msg}], counts}`) · `/ingest/rollback` · `/ingest/reset-mock` · `/stage/run/{slot}`(501 stub)

**검수·편집(W, 제한적) · M3**: `GET /review/queue`(items + **orphans 파생**) · `POST /review/approve` · `/review/reject` · `/review/approve-batch` · `/nodes/{id}/edit`(canonical_name/definition/spec/status, id 불변) · `/nodes/{id}/alias`(추가/삭제) · `/review/absorb`(별칭 흡수 + evidence cid→생존노드 describes 근거 보존)

**관계(엣지) 편집(W) · M5**: `POST /edges/edit { op:add|delete|update, source, relation, target, new_source?, new_relation?, new_target? }`. 전부 store.commit. part_of 변이 시 `attached_to` 동기화. 중복 엣지 금지. 타입 변경 시 category sanity 경고(막지 않음).

> **금지 엔드포인트**: Neo4j 직접쓰기 · **노드** merge · 임베딩 저장 · orphan 자동 해소. (엣지 재지정/타입변경/삭제/추가는 M5에서 활성.)

---

## 6. 불변 원칙 — 가드레일 (MUST NOT VIOLATE)
1. **id 불변·무의미**(N####). 재발급·의미부여 금지.
2. **임베딩 비저장.** 읽기 경로는 임베딩을 읽지도 않는다.
3. **단일 원천 = JSON.** 모든 쓰기 JSON에만(store.commit). **Neo4j = JSON 에서 재생성되는 읽기 전용 파생 캐시 — 직접쓰기 절대 없음(M7 재확인).** 쓰기 = store.commit(JSON) → 그 후 `on_change`→neo4j 재생성. 이중 원천 금지.
4. **사람 최종 승인 / 뼈대=승인경로만.** 노드·엣지 *생성·확정*은 검수 승인으로만. 스테이지/주입은 제안·로딩까지, 자동 확정 금지.
5. **콘텐츠(Mode D) resolve-only.** 새 뼈대 노드 생성 금지.
6. **질의/탐색 시 alias 비누적**(용어사전 오염 방지). 단, 검수 시 명시적 alias 추가/별칭 흡수는 *사람의 결정*이라 허용.
7. **계약 기반 결합.** 스테이지 구현 하드코딩 금지.
8. **안티 오버엔지니어링.** 측정/요구가 정당화하기 전 범위(§10) 선구현 금지.
9. **업로드 ≠ 승인.** 수동 주입은 부트스트랩/테스트 로딩. 업로드된 `proposed`는 M3 승인 대상으로 보존. 신뢰된 운영자 경로(README 명시).
10. **모든 skeleton 변경은 안전쓰기 경로(M2 `store.py`) 경유.** 백업→쓰기→전체 재검증→깨지면 자동 롤백. M3·M5 쓰기 전부 포함. **엣지 변이(M5)**: part_of 재지정/삭제/추가 시 노드 `attached_to` 와 반드시 동기화(어긋나면 안 됨). 없는 노드 참조는 재검증에서 막혀 롤백. 중복 엣지(동일 source-relation-target) 금지.

---

## 7. 빌드 순서 (밀스톤 + 검증 게이트)

### M1 — Explore(읽기/NVL) · DONE ✅
검증 통과(`verify_m1.mjs`). 핵심: 임베딩 0 기동 · `/graph` 렌더 · 노드 클릭→상세+청크. 결정: canvas+disableWebGL, 결정적 `layout.ts`, nodes dict/`attached_to`. 파일: `backend/{app,reader}.py`, `frontend/src/{api,theme,layout,App,components}`.

### M2 — 수동 JSON 주입 · DONE ✅
검증 통과(`verify_m2.mjs`). 핵심: 검증 2층(`validate.py`: 스키마+참조무결성, 라인별 에러) · `data/{current,mock,_backup}` 3분리 · `store.py`(백업/롤백+재검증, 교차-slot 자동 롤백) · `?adopt` dry-run · 업로드≠승인. 파일: `backend/{validate,store}.py`, `frontend/.../{DataManage,SlotUpload}.tsx`.

### M3 — 검수/승인/편집 Workbench · DONE ✅ (as-built 정본)
> **정합 판정**: 리뷰 큐는 *별도 `review_queue.json`(후보 항목)* 모델을 정본으로 채택. 초안의 "SSOT 파생 큐"는 폐기 — evidence(근거 청크) 연결이 불가능하고 describes 무결성과 충돌하기 때문.

**(a) 리뷰 큐 = `review_queue.json`(후보 5종)**, `current/`에 시드(SSOT 파생 아님). 항목: `new_unit`·`new_factor`·`orphan_unit`·`orphan_factor`·`orphan_chunk_link`. 근거는 contents 의 evidence 청크를 `evidence_cids` 로 참조(describes 미부착 → 미존재 노드 참조 회피). 추가로 엣지 삭제로 고아된 노드는 `/review/queue` 의 `orphans` 로 파생 표시(M5).

**(b) 액션 — 쓰기 시맨틱** (전부 §6.10 안전쓰기 경유):
- **승인** `/review/approve`(+`attach_to?`): 후보 → **신규 노드 materialize**(id `max+1`, status `confirmed`) + 부착 엣지(part_of/has_property) 생성. `attach_to` 로 "부착위치 수정 후 승인"(orphan).
- **거부** `/review/reject`: **후보(큐 항목)만 제거**(아직 skeleton 에 없으므로 노드/엣지/describes 변경 없음).
- **별칭 흡수** `/review/absorb`(후보 → 기존 confirmed) — **근거 보존**:
  1. 후보 `surface`+`aliases` → 생존 노드 `aliases` 추가
  2. 후보 `evidence_cids` 마다 `describes{cid → 생존노드}` 추가(중복 제거) — **근거 청크 보존**
  3. 후보를 큐에서 제거
  - 보고: 추가 alias K · 연결 describes M. (생존 노드 confirmed → describes 무결성 통과.)
- **일괄 승인** `/review/approve-batch`: 선택 후보 approve(미부착 orphan 은 skip).

**(c) 화면3 좌우 분할**: 좌 NVL 맥락 그래프(노드 클릭→우측 노드 편집폼) / 우 리뷰 큐(일괄승인)+고아 서브섹션+선택 항목 에디터(근거 청크+액션). §4 화면3.

**(d) orphan = 표시만 (§10)**: 후보 orphan 은 부착위치 지정 후 개별 승인. 구조적 고아(M5)는 관계 추가로 재연결. 노드 merge/delete 없음.

**M3 검증 게이트** (`verify_m3.mjs` + `verify_m3_reconcile.mjs`):
1. 후보 승인 → 신규 노드 materialize + 재렌더 ✅
2. 거부 → 후보 큐 제거 ✅
3. 별칭 흡수 → alias 추가 + **evidence cid → describes 생성(근거 보존)** + 후보 제거, 생존노드 `/nodes/{id}/chunks` 에 근거 노출, describes 무결성 통과 ✅
4. 부착위치 수정 후 승인 ✅ / 일괄 승인 ✅
5. **부재 확인**: 노드 merge/delete 없음(404) ✅
6. 모든 쓰기 백업·재검증 통과(§6.10) ✅

### M5 — 관계(엣지) 편집 · DONE ✅
의도된 앞당김: §10에서 미뤘던 edge move/delete 를 활성화(정당화: M2/M3 안전쓰기로 구조변경 최소 안전 확보). **노드 merge·거버넌스 풀세트는 여전히 비범위.**
구현: NodeEditForm 하단 "관계" 섹션(`RelationEditor`) + `POST /edges/edit`. add/delete/update(재지정·타입변경). part_of↔`attached_to` 동기화. 중복 금지. category sanity 경고. 엣지 삭제로 고아된 Unit/Property 는 `/review/queue` orphans 로 파생 표시 → 관계 추가로 재연결. `store.commit` 을 전체 검증으로 강화(엣지의 없는-노드 참조 포착).
**노드 선택 = 검색형 콤보박스(`NodePicker`, name/alias/id 매치 + 직접 id 입력, `GET /nodes/search?q=`)** — target 을 주인공으로(넓은 콤보 + 현재 대상 이름·id 표시), 부모 행 빈 드롭다운 버그 해소. 레이아웃은 grid(`[relation ▾] → [target 콤보] [삭제/추가]`). 검증 `verify_node_picker.mjs` exit 0.
검증 `verify_edge_edit.mjs` exit 0: ①part_of 재지정→부모 변경+attached_to 동기화 ②없는 노드 재지정→거부+자동롤백+SSOT 불변 ③삭제→고아 표시 ④추가+중복 방지(422) ⑤노드 id 불변+노드 merge 부재(404) ⑥모든 변이 백업·재검증. 파일: `backend/{mutations,store,reader,validate,app}.py`, `frontend/.../{RelationEditor,NodeEditForm,Workbench}.tsx`.

### M4 — 플러그형 스테이지 슬롯(인터페이스 + 외부 실행) · DONE ✅
`stages.py`: `Stage(Protocol)` / `ManualUploadStage`(실행 경로 없음) / `ExternalScriptStage`(**실기능** — `<cmd> <in.json> <out.json>` subprocess, 비정상종료·출력없음·깨진JSON → `StageError`). 슬롯 `parser`/`skeleton`/`content` → config(`data/stage_config.json` + env `STAGE_<SLOT>`, `manual`|`external:<cmd>`). `GET/PUT /stage/config`. `/stage/run/{slot}` 501 해제: manual→400(수동 전용 안내), external→subprocess 실행 후 **외부 출력은 미신뢰 → validate + `store.upload(adopt)` (백업·전체 재검증·자동롤백) 게이트로만 채택**. 화면1 스테이지 슬롯에 config 반영(external 배지 + 실행 버튼).
검증 `verify_m4.mjs` exit 0: ①echo 스크립트 config→`/stage/run/skeleton`→subprocess→출력 회수 ②검증·채택→SSOT 반영(11→12) ③깨진 출력→422 거부+SSOT 불변 ④manual 슬롯→400 ⑤회귀 M1/M2/M3/M5 exit 0. 파일: `backend/{stages,store,app}.py`, `frontend/.../DataManage.tsx`.

### M6 — 대시보드(읽기 전용 현황) · DONE ✅
`GET /dashboard/stats`(`reader.dashboard_stats`, 임베딩 미로드·쓰기 없음): 규모(노드·엣지·청크·describes + 카테고리/관계별), status 분포(proposed/confirmed), 공정별 커버리지(대공정 서브트리 노드·청크 수 — 빈 공정 식별), 리뷰 큐 종류별+구조적 orphans, 동의어 사전 누적 alias(flywheel), 건강(unlinked 청크율·orphan 노드율). 프론트 `Dashboard.tsx`(네비 4번째 탭, 카드 + CSS/SVG 막대 — recharts 미사용).
검증 `verify_m6.mjs` exit 0: ①집계 정확(노드11·카테고리·엣지15·관계·status·큐·alias10·unlinked율0.667) ②탭 렌더+카드6+막대 ③커버리지 backbone 6공정+노드·청크 ④임베딩 미로드 ⑤회귀 7스위트 exit 0. 파일: `backend/{reader,app}.py`, `frontend/.../Dashboard.tsx`.

### M7 — Neo4j 승격 + 1000-노드 스케일 검증 · DONE ✅
**★가드레일 §6.3**: JSON=SSOT, Neo4j=재생성되는 읽기 전용 파생 캐시(직접쓰기 절대 없음). 모든 쓰기 store.commit(JSON)→`on_change`→neo4j 재생성.
- `neo4j_sync.sync_to_neo4j`(driver-based, 전량 재생성, 라벨=category·관계=PART_OF/…, Chunk+DESCRIBES) + `Neo4jReader`(JsonReader 상속, `_load_*`만 Cypher → 동일 결과 보장).
- config: 읽기 엔드포인트 `?backend=json|neo4j`(기본 json). 연결 `NEO4J_URI/USER/PASSWORD`. `POST /neo4j/sync`(적재·활성화), `/neo4j/status`, `/neo4j/deactivate`. 미가동/실패 → 503 명확 에러(앱 기본 json 이라 fallback 자명).
- **스케일 fixture**(§9): `data/mock/scale/gen_scale.py` → 1027노드(backbone 6공정 아래 합성 Unit/Property + 청크/describes), 스키마 준수. M7 검증은 11노드가 아닌 이 1000-fixture 로 수행.

검증 `verify_m7_neo4j.mjs` exit 0 (1027-fixture):
1. JSON→Neo4j 적재(1027) 후 `?backend=neo4j` == `?backend=json` **동일 결과**(graph nodes/rels·status·node 상세·dashboard) ✅
2. 응답시간 측정·기록: full-graph 읽기 json≈18ms vs neo4j≈70ms — **full-dump 은 JSON 유리**(Neo4j 왕복+재구성). Neo4j 가치는 그래프 순회/동시성. (sync≈230ms)
3. **렌더-at-scale 관찰**: 공정 스코프(노칭) 171노드 Explore 렌더 — canvas 그려짐(nonblank 12.8%)이나 **밀집**. 대규모(전극/화성) 가면 WebGL+layout+스코핑 필요 → **M8 신호로 기록**. ✅(관찰)
4. JSON 변이(`/nodes/{id}/edit`)→store.commit→`on_change` 자동 재생성→neo4j 반영 / Neo4j 직접쓰기 엔드포인트 부재(404) ✅
5. 회귀 8 스위트 exit 0(기본 11노드 mock 유지) ✅
파일: `backend/{neo4j_sync,reader,store,app}.py`, `data/mock/scale/gen_scale.py`. (Neo4j 5-community on docker, `neo4j` 드라이버.)
- **진단 — 백엔드 토글**: Explore/대시보드 상단 [JSON⇄Neo4j] 토글 + 응답시간(ms). 프론트 `backend.tsx`(context+토글), 읽기 쿼리에 `?backend=` 전환. 같은 데이터→차이는 속도뿐. `verify_backend_toggle.mjs` exit 0: ①동일 렌더 ②응답시간 표시 갱신 ③Neo4j 미가동(docker stop)→토글 비활성+json 동작(neo4j 503·json 200) ④1027 시간차 가시화(JSON≈30ms vs Neo4j≈550ms) ⑤회귀.

---

## 8. 기술 스택 / 셋업
- 백엔드: FastAPI+uvicorn(`pip install --break-system-packages fastapi uvicorn`), 기존 `common/` import.
- 프론트: React+Vite+TS, TanStack Query, `@neo4j-nvl/{base,react,interaction-handlers}`. 스타일 미니멀.
- NVL: Canvas, `disableTelemetry:true`, `disableWebGL`은 config. 라이선스는 실배포 전 별도 확인.
- 데이터: `data/current`(SSOT)·`data/mock`(원본)·`data/_backup`. M1~M3는 게이트웨이/LLM 불필요.
- 실행: localhost 단일유저·무인증(헤드리스 서버면 포트포워딩).

---

## 9. Mock 데이터
- `data/mock/`(11노드): backbone + Unit/Property + proposed/evidence 청크 + `review_queue.json`. 기본 SSOT·M1~M6 검증용.
- **스케일 fixture** `data/mock/scale/`(M7): `gen_scale.py` → 1027노드(backbone 6공정 아래 합성 Unit/Property + 청크/describes), §2 스키마 준수, 결정적. M7 스케일 검증 전용(평소 SSOT 아님).

---

## 10. 명시적 비범위 (안 함)
- **노드 merge** — 거버넌스(감사로그·undo)와 함께 다음 단계. (엣지 재지정/타입변경/삭제/추가는 **M5에서 활성화됨**. 노드 재부모는 part_of 엣지 재지정으로 달성. 노드 delete 는 비범위.)
- 테스트/Eval(골든셋) · 거버넌스 풀세트(감사로그·버전·롤백·권한). (대시보드는 M6에서 완료.)
- orphan **자동 해소**(표시만; 수동 재연결은 M5 관계 추가로 가능) · 멀티유저/인증. (Neo4j 승격은 M7에서 완료.)
- 외부 파이프라인 *구현*(파싱/뼈대 코드) — 슬롯 인터페이스만.

> 단, **M2 백업/롤백 1회**·**M3·M5 안전쓰기 재검증**은 거버넌스 풀세트가 아니라 *파괴적/변경 연산의 최소 데이터 위생*이라 포함한다.

---

*끝. 모순/불명확 시 멈추고 §6 우선, 그다음 사용자 확인.*