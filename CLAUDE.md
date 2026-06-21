# CLAUDE.md — 온톨로지 관리 플랫폼(관리소) 빌드 스펙 · v3

> **진행 상태**: M1~M11 ✅ · **M12(이벤트 층 스캐폴드: FailureMode/Cause + Mode C + 추적질의) ✅**. 비범위 잔여: 거버넌스 풀세트·실 임베딩 보강·실 taxonomy 정밀화.
> **이 문서는 빌드 명세다.** §7 밀스톤 순서대로, 각 밀스톤의 **검증 게이트를 통과한 뒤** 다음으로. 한 번에 전부 만들지 말 것.
> **§6 불변 원칙은 절대 위반 금지.** 충돌 시 멈추고 §6 우선, 그다음 사용자 확인.
> **사용법**: 이 파일은 레포 루트에 두면 Claude Code가 자동 로드한다. 밀스톤 착수는 짧은 포인터(예: "M3 진행, §7 따라가")로 충분 — 전체 재첨부 불필요.

### 변경 이력
- **v3.9**: M12(이벤트 층 스캐폴드) — §2 category += FailureMode/Cause, relation += causes/affects. Mode C(이슈 인입: FailureMode/Cause 후보→승인 materialize+엣지). `/retrieve` causes/affects **양방향** 추적. 층 분리(Mode C는 구조 resolve-only·발생=청크). mock baseline 30노드. **§10 FailureMode/Cause "Phase 2" 해소.** verify_m6 견고화(mock 재계산). 실 meta/taxonomy는 실 샘플 후 정밀화.
- **v3.8**: M11(검색 + Eval) — `GET /retrieve`(별칭+렉시컬 링킹→part_of/has_property 탐색→describes 수집, **임베딩-free**), `golden_set.json`(21문항·4패턴), `/eval/run`(Recall@k·MRR·패턴분해·alias gap). 화면6 Test/Eval. §6.6 재확인(질문 alias 미누적). 경계: 임베딩-보강 링킹+매칭 eval = 사내 확장.
- **v3.7**: M10(mock 6공정 확장) — 11→**26노드**(6공정 각 Unit+Property 2~3, 동의어 영문/축약), 청크 6→14·describes 4→19, 6공정 모두 커버(unlinked 0.667→0.286). 기존 노드 id(N0001/N0101/N0102/N02xx) 보존. 카운트 단언 갱신(m2/m3/m4 카운트-무관, m6 새 baseline).
- **v3.6**: M9(인입 워크스페이스) 추가·완료 — 배치 단계별 흐름(①업로드~⑤연결), MockStage(데모)·배치 래퍼(`ingest_batch`). **§3.3 정정**(common/ 무의존) + **§6.7 승격**: platform은 `ontology_agent` 코드 의존 0, JSON 계약만 공유.
- **v3.5**: M8(렌더-at-scale) 추가·완료 — 확장형 스코핑(ego: 포커스+이웃, ~50 유지, 클릭 확장) + 레이아웃 분기(결정적↔NVL force 워커) + WebGL config 토글. §3.5 반영, M7 M8-신호 해소.
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
- 노드: `id`(불변·무의미 N####), `canonical_name`, `category`(구조 **Process|Unit|Property** + 이벤트 **FailureMode|Cause**, M12), `definition`, `aliases`[], `spec`(Property용, 필드), `status`(proposed|confirmed), `provenance`, 부착 **`attached_to`**(이벤트 노드는 null — causes/affects 로만 결합).
- `edges`: `source`, `relation`(구조 **part_of|precedes|has_property** + 이벤트 **causes|affects**, M12), `target`, `status`, `provenance`. 이벤트 의미: `Cause --causes--> FailureMode --affects--> Property|Unit|Process`.
- **발생/이력은 노드 아님 — 청크**(meta: date/line/lot) → `describes` FailureMode. (발생 노드화 금지)

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

**3.3 백엔드(FastAPI, `platform/backend/`)**: **`ontology_agent` 코드 의존 0** — 초안의 "common/ import 재사용"은 폐기. 데이터 계약(§2 스키마)만 공유하고 구현은 독립(JSON 직독). **읽기 경로는 JSON 직접 파싱 경량 read-model** — `Skeleton.load()` 류 절대 금지(임베딩 재계산해 BGE-M3 부팅). `sentence-transformers` 없이 기동(M1 준수). 스테이지 어댑터: `ManualUploadStage`/`ExternalScriptStage`(M4)/`MockStage`(M9 데모).

**3.4 읽기 어댑터**: `GraphReader` → `JsonReader`(기본) / `Neo4jReader`(M7, 구현됨). **Neo4jReader = JsonReader 의 데이터 소스만 Cypher 로 교체**(`_load_skeleton`/`_load_contents` override) → 집계/조회 로직 전부 상속 ⇒ JsonReader 와 동일 결과 보장. 프론트는 `GraphReader`만 본다(시그니처 불변); 읽기 엔드포인트 `?backend=json|neo4j`. **Neo4j 는 JSON 에서 재생성되는 읽기 전용 파생 캐시(§6.3)** — SSOT 변경 시 `store.on_change` 훅이 `neo4j_sync` 자동 재생성.

**3.5 프론트(React+Vite+TS, `platform/frontend/`)** — *M1 구현 반영*:
- `@neo4j-nvl/react`(+interaction-handlers). **`disableTelemetry:true` 필수.**
- 캔버스라 **노드 안 HTML 금지** — 상세·편집은 옆 패널.
- **렌더-at-scale(M8)** — flat 덤프 금지:
  - **확장형 스코핑(ego)**: 스코프가 임계(60) 초과 시 통째 렌더하지 않고 **포커스+이웃**만(`ego.ts`), 화면에 ~50 이하 유지, 클릭으로 이웃 on-demand 확장. [전체 평면 보기] 토글로 flat 전환 가능.
  - **레이아웃 분기**: ≤임계=결정적 좌표(`layout.ts` 계층 / ego 방사형); flat·수백 노드=NVL `forceDirected` 워커. (`GraphCanvas` `layoutMode`)
  - **WebGL config**: `disableWebGL` 토글 — 노드 임계(300) 초과 시 WebGL 권장(수동 토글도). 헤드리스는 Canvas 유지. (`data-renderer`)
  - 소규모(mock 11)는 현행 결정적 계층 그대로(회귀 없음).

---

## 4. 화면

**화면2 — Explore(읽기 전용) · DONE ✅**: 3-pane(좌 스코프·필터·검색 / 중앙 NVL 캔버스 / 우 노드 상세+describes 청크 원문+출처+인접관계). 상단 **백엔드 토글(JSON⇄Neo4j)+응답시간(ms) 표시**(진단, 대시보드도; `?backend=` 전환, 같은 데이터·차이는 속도뿐, 미가동 시 비활성+json fallback).

**화면1 — 데이터 관리+수동 주입 · DONE ✅**: SSOT 상태/slot 테이블, 3 slot 주입 카드(검증→채택은 valid 시만), 직전 롤백·mock 리셋, 스테이지 슬롯 표시. 업로드≠승인 명시.

**화면6 — Test/Eval · DONE ✅ (M11)**: 검색(retrieval) + 골든셋 평가. 골든셋 표 + [평가 실행]→문항별 Recall@k/rank + 패턴별 집계 + 미해소(alias gap) 목록 + "온톨로지에 질문하기"(검색 박스). 읽기 전용·임베딩 미사용.

**화면5 — 인입 워크스페이스 · DONE ✅ (M9)**: 문서→json 통합 인입. 상단 단계 진행바(①업로드~⑤연결), 배치 테이블(행=문서, 칩=파싱/연결 + 청크·describes·orphan 수), 행 클릭→문서 청크/describes 미리보기. ③뼈대·④검수=배치 공유 밴드, ④는 검수 Workbench 핸드오프.

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

**읽기(R) · DONE**: `GET /data/status` · `/graph?scope={id}`(NVL 포맷) · `/nodes/{id}`(**embedding 미포함**) · `/nodes/{id}/chunks` · `/nodes/search?q=` · `/review/queue` · `/dashboard/stats`(M6) · **`/retrieve?q=`(M11 검색, 임베딩-free)** · **`/eval/golden`·`POST /eval/run?k=`(M11 평가)**. 읽기 엔드포인트는 `?backend=json|neo4j`(M7, 기본 json) 지원.

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
5. **콘텐츠(Mode D)·이벤트(Mode C) resolve-only / 층 분리(M12).** Mode D 는 새 뼈대 노드 생성 금지. **Mode C 는 Process/Unit/Property 를 *수정 못 함*** — affects/describes 는 구조 노드를 *참조*(resolve-only)만. 새 노드는 FailureMode/Cause 만, 승인 게이트 거쳐. 발생 건은 노드 아님(청크).
6. **질의/탐색 시 alias 비누적**(용어사전 오염 방지). **검색(M11 `/retrieve`)도 질문 표현을 alias 에 쌓지 않는다 — 읽기 전용.** 단, 검수 시 명시적 alias 추가/별칭 흡수는 *사람의 결정*이라 허용.
7. **계약 기반 결합 / `ontology_agent` 코드 의존 0.** platform 은 처리소(`ontology_agent`) 코드를 import 하지 않는다 — **JSON 계약(§2)만 공유**. 스테이지 구현 하드코딩 금지(Manual/External/Mock 어댑터, config 선택). 읽기 경로는 임베딩/BGE-M3 부팅 금지.
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
3. **렌더-at-scale 관찰**: 공정 스코프(노칭) 171노드 — flat 렌더 시 밀집. → **M8에서 해소**(확장형 스코핑). ✅(관찰)
4. JSON 변이(`/nodes/{id}/edit`)→store.commit→`on_change` 자동 재생성→neo4j 반영 / Neo4j 직접쓰기 엔드포인트 부재(404) ✅
5. 회귀 8 스위트 exit 0(기본 11노드 mock 유지) ✅
파일: `backend/{neo4j_sync,reader,store,app}.py`, `data/mock/scale/gen_scale.py`. (Neo4j 5-community on docker, `neo4j` 드라이버.)
- **진단 — 백엔드 토글**: Explore/대시보드 상단 [JSON⇄Neo4j] 토글 + 응답시간(ms). 프론트 `backend.tsx`(context+토글), 읽기 쿼리에 `?backend=` 전환. 같은 데이터→차이는 속도뿐. `verify_backend_toggle.mjs` exit 0: ①동일 렌더 ②응답시간 표시 갱신 ③Neo4j 미가동(docker stop)→토글 비활성+json 동작(neo4j 503·json 200) ④1027 시간차 가시화(JSON≈30ms vs Neo4j≈550ms) ⑤회귀.

### M8 — 렌더-at-scale (확장형 스코핑 + 레이아웃 + WebGL) · DONE ✅
동기(측정 기반 §6.8): M7 1027-fixture에서 공정 스코프 171노드 flat 덤프가 밀집 → 스케일에 맞춰 보강.
- **확장형 스코핑(`ego.ts`, 핵심)**: 스코프>임계(60)면 통째 렌더 금지 — 포커스+이웃만(`egoView`), 화면 ~50 이하, 클릭으로 이웃 확장(`computeEgoLayout` 방사형). [전체 평면 보기] 토글.
- **레이아웃 분기(`GraphCanvas.layoutMode`)**: ≤임계 결정적(layout.ts/ego 방사형) ↔ flat·수백노드 NVL `forceDirected` 워커. (NVL 워커가 positions 미주입 시 정상 분산 확인.)
- **WebGL config**: `disableWebGL` 토글(노드>300 권장 + 수동), 헤드리스 Canvas 유지. `data-renderer` 노출.
검증 `verify_m8.mjs` exit 0 (1027-fixture): ①171 스코프→확장형 35/171(≤50)+검색클릭 확장(35→39) ②전체 평면→`force` 레이아웃 분산 렌더 ③WebGL 토글(canvas→webgl) ④소규모(11 mock) 결정적·scale-bar 없음(회귀) ⑤9 스위트 회귀 exit 0. 파일: `frontend/src/{ego.ts,views/Explore.tsx,components/GraphCanvas.tsx}`.

### M9 — 인입 워크스페이스 (배치 단계별 흐름) · DONE ✅
스테이지 슬롯(M4) 위 **UI 오케스트레이션만** — 검수(M3)·store·validate 재사용. 흐름(게이트): ①업로드(N문서)→②파싱(per-doc)→③뼈대(배치 공유, 후보→리뷰 큐)→④검수/승인(M3 공유 큐)→⑤콘텐츠 연결(per-doc, Mode D).
- per-doc(①②⑤) / batch-shared(③④): 전 문서 청크→하나의 스켈레톤·하나의 큐·승인 1회. 게이트: ②없이 ③ 불가, ③(+검수) 없이 ⑤ 불가.
- `ingest_batch.py`: 배치 상태(`data/current/ingest_batch.json`) + run_parse/skeleton/content. 얇은 래퍼 `/ingest/batch/run/{stage}`, 스테이지는 config 로 external 스왑(기본 `MockStage` 데모, 결정적·§2 준수).
- 모든 채택 store.commit(백업·재검증·자동롤백). ③은 후보(proposed)까지 — **업로드≠승인(§6.9)**: 노드는 ④승인에서 materialize. ⑤ 미해소는 `orphan_chunk_link`(문서별).
검증 `verify_m9_ingest.mjs` exit 0: ①다문서 업로드→파싱 행마다 청크수(2,2) ②뼈대→배치 후보 2 하나의 큐(from_batch) ③③승인전 ⑤차단/승인후 ⑤가능 ④연결→per-doc describes 1·orphan 1 ⑤MockStage ①~⑤ 클릭 시연(노드 +2 ④에서) ⑥회귀 exit 0. 파일: `backend/{stages,ingest_batch,app}.py`, `frontend/.../Ingest.tsx`.

### M10 — mock 6공정 확장 (eval·데모용) · DONE ✅
현 mock(11노드·노칭만 청크)을 **6공정 충실**로 확장 — 골든셋 작성·데모 가능. `data/mock/` 만 갱신(작업 SSOT는 reset-mock 시드), §2 스키마·참조무결성 통과.
- 6공정 각 Unit 1 + Property 2~3, 공정별 청크가 그 Unit/Property describes(6공정 커버), 동의어(영문/축약). **기존 노드 id 보존**(node_picker/edge_edit 무영향).
- 결과 baseline: 11→26노드, 청크 6→14, describes 4→19, unlinked 0.667→0.286, alias 23. **6공정 모두 커버(대시보드 빨강 0)**.
- ★카운트 단언 갱신: m2/m3/m4 **카운트-무관**(baseline 델타), m6 **새 baseline 상수**.
검증 `verify_m10_mock.mjs` exit 0: ①6공정 모두 Unit·Property·청크(커버리지 빨강 0) ②unlinked 개선·동의어 검색 ③스키마·참조무결성 ④전 화면(Explore·대시보드·인입·검수) 정상 ⑤회귀 11 스위트 exit 0. 파일: `data/mock/{assembly_skeleton,contents}.json`.

### M11 — 검색(retrieval) + Eval · DONE ✅
검색 = 질문 → **①링킹(별칭 exact + 렉시컬 substring)** → **②탐색(part_of/has_property)** → **③수집(describes 청크)**. 임베딩 불필요 → mock 에서도 Recall 의미있음. 부수효과: "온톨로지에 질문하기". **읽기 전용·임베딩 미로드(§6.2)·질문 alias 미누적(§6.6)·`ontology_agent` 무의존(§6.7).**
- `reader.retrieve(q,k)`(JsonReader 메서드 → Neo4jReader 상속): 링크 노드 describe=2·탐색 노드=1 가중 랭킹. 미해소(링크 0)=**alias gap**(임베딩 fallback 없음 — 경계: 사내 실 임베딩 확장).
- `golden_set.json`(data root, SSOT 미복사): 21문항·4패턴(P1 direct/P2 process/P3 backtrace 가중/P4 synonym), gold_chunks=실 mock cid, 비-canonical 표면형(영문·축약·동의어). `POST /eval/run?k=`: Recall@k·MRR·패턴별 분해·gap 목록. 골든셋 고정.
검증 `verify_m11_eval.mjs` exit 0: ①알려진 질문→gold 노드/청크(별칭+탐색만) ②Recall@5=1.0·MRR≈0.95·4패턴 분해 ③미해소→gap(임베딩 fallback 없음) ④alias 미누적·임베딩 미로드 ⑤회귀 12 스위트 exit 0. 파일: `backend/{reader,app}.py`, `data/golden_set.json`, `frontend/.../Eval.tsx`.

### M12 — 이벤트 층 스캐폴드 (FailureMode/Cause + Mode C + 추적질의) · DONE ✅
3번째 층(이벤트)을 mock 위 스캐폴드 — PFMEA 역추적("X 불량 원인?")이 돌게. 발생은 청크(노드 아님), 타입만 노드. M3 승인·M9 인입·safe-write·`/retrieve` 재사용.
- **스키마**(§2): category += FailureMode/Cause, relation += causes/affects. `Cause→causes→FailureMode→affects→구조`. validate 참조무결성 하드, 방향(category)=경고(M5 패턴, 막지 않음).
- **★층 분리(§6.5)**: Mode C 는 구조(Process/Unit/Property) 미수정 — affects/describes 는 resolve-only 참조. 발생=청크(meta date/line/lot)→describes FailureMode. 새 노드는 FailureMode/Cause 만, 승인 게이트.
- **Mode C 인입**: `MockStage(event)` + `/ingest/batch/run/event` — 이슈 doc → 후보(`new_failuremode`/`new_cause`) + 발생 청크. 승인(M3 `mutations._apply_one`) → materialize + causes/affects 엣지 + 발생청크 describes. 전부 store.commit.
- **추적 질의**: `/retrieve` 가 causes/affects 를 **양방향** 탐색(링크=3·구조=2·이벤트=1 가중). "버발생 원인?"→금형마모(Cause)+책임 인자/설비(affects)+이슈청크. 구조 노드→affects⁻¹→관련 FailureMode 역도달.
- **시각화**: `theme.ts` FailureMode(빨강)/Cause(보라). Explore/대시보드 카테고리 필터·카운트에 이벤트 층.
검증 `verify_m12_event.mjs` exit 0: ①스키마 수용+방향경고+참조무결성 ②대시보드 이벤트 카운트+Explore 필터 ③Mode C: 후보→승인 materialize+엣지+describes ④추적(버발생→causes+affects+이슈청크, 역도달) ⑤층분리(구조 26→26 불변)+발생=청크 ⑥회귀 13 스위트 exit 0. 파일: `backend/{validate,mutations,stages,ingest_batch,reader,app}.py`, `data/mock/*`, `frontend/src/{theme.ts,views/Explore.tsx,components/LeftPanel.tsx}`.
> 실 구조 의존부(meta 필드·불량/원인 taxonomy)는 실 샘플 도착 후 정밀화.

---

## 8. 기술 스택 / 셋업
- 백엔드: FastAPI+uvicorn(`pip install --break-system-packages fastapi uvicorn neo4j`). **`ontology_agent` 무의존**(§3.3/§6.7).
- 프론트: React+Vite+TS, TanStack Query, `@neo4j-nvl/{base,react,interaction-handlers}`. 스타일 미니멀.
- NVL: Canvas, `disableTelemetry:true`, `disableWebGL`은 config. 라이선스는 실배포 전 별도 확인.
- 데이터: `data/current`(SSOT)·`data/mock`(원본)·`data/_backup`. M1~M3는 게이트웨이/LLM 불필요.
- **mock baseline(M12)**: **30노드**(Process 7·Unit 7·Property 12·**FailureMode 2·Cause 2**), 엣지 36(+causes 2·affects 4), 청크 17(+이슈 3), describes 24, alias 27. 6공정 커버 + 이벤트 층 2 trace 체인. **verify_m6 는 mock 파일에서 기대값 재계산**(카운트 상수 비의존 — 추가 변경에도 견고).
- 실행: localhost 단일유저·무인증(헤드리스 서버면 포트포워딩).

---

## 9. Mock 데이터
- `data/mock/`(**30노드, M12**): 6공정 충실(각 Unit 1 + Property 2~3, 청크 describes, 동의어) + **이벤트 층**(FailureMode 버발생·적층정렬불량 / Cause 금형마모·센서드리프트 / causes·affects / 이슈 청크 meta date·line·lot). 기존 노드 id 보존. + `review_queue.json`·`golden_set.json`(data root).
- **스케일 fixture** `data/mock/scale/`(M7): `gen_scale.py` → 1027노드. M7/M8 스케일 검증 전용(평소 SSOT 아님).

---

## 10. 명시적 비범위 (안 함)
- **노드 merge** — 거버넌스(감사로그·undo)와 함께 다음 단계. (엣지 재지정/타입변경/삭제/추가는 **M5에서 활성화됨**. 노드 재부모는 part_of 엣지 재지정으로 달성. 노드 delete 는 비범위.)
- 테스트/Eval(골든셋) · 거버넌스 풀세트(감사로그·버전·롤백·권한). (대시보드는 M6에서 완료.)
- orphan **자동 해소**(표시만; 수동 재연결은 M5 관계 추가로 가능) · 멀티유저/인증. (Neo4j 승격은 M7에서 완료.)
- 외부 파이프라인 *구현*(파싱/뼈대/이벤트 코드) — 슬롯 인터페이스만(Mode C 포함, MockStage 데모).
- 실 불량/원인 taxonomy·발생 meta 스키마 정밀화 — 실 샘플 도착 후. (이벤트 층 *스캐폴드*는 M12에서 완료.)

> 단, **M2 백업/롤백 1회**·**M3·M5 안전쓰기 재검증**은 거버넌스 풀세트가 아니라 *파괴적/변경 연산의 최소 데이터 위생*이라 포함한다.

---

*끝. 모순/불명확 시 멈추고 §6 우선, 그다음 사용자 확인.*