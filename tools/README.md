# tools — 공유용 HTML 내보내기

현재 SSOT(온톨로지 데이터)를 **데이터가 박힌 단독 HTML** 한 파일로 뽑아, 서버·인터넷 없이
공유할 수 있게 한다. 시각화 페이지(Explore)와 같은 파스텔 그래프를 그대로 담는다.

## 흐름

1. **데이터 넣기** — 플랫폼의 `데이터 관리 > 수동 JSON 주입`으로 최종 JSON을 넣는다.
   → `data/current/assembly_skeleton.json`(+`contents.json`)에 반영된다. (이게 SSOT)
2. **HTML 생성**
   ```bash
   python tools/gen_share_html.py
   ```
   → 레포 루트에 `ontology_share.html` 생성(현재 `data/current` 반영).
3. **공유** — 그 파일 하나만 이메일·드라이브·사내망에 올리면, 받는 사람이 브라우저로
   더블클릭해 연다. 설치·서버·인터넷 불필요.

## 옵션

```bash
python tools/gen_share_html.py --out 공유본_2025Q1.html   # 출력 경로 지정
python tools/gen_share_html.py --data data/mock            # 다른 데이터 폴더로
python tools/gen_share_html.py --skeleton a.json --contents b.json   # 파일 직접 지정
```

## 포함되는 것 / 안 되는 것

- **포함**: 노드(이름·카테고리·정의·동의어·spec·부착·출처문서) · 엣지(관계) · 청크 원문 ·
  describes(근거 연결). 그래프는 force 배치, 카테고리/관계/상태 필터, 검색, 노드 상세 패널,
  라이트/다크 자동.
- **비포함**: 임베딩(§6.2 — 읽기 경로에서도 노출 금지). 편집 기능 없음(읽기 전용 스냅샷).

## 파일

- `gen_share_html.py` — 생성기(데이터 로드 + 템플릿 주입 + 완결 HTML 문서로 감쌈).
- `share_template.html` — 시각화 템플릿(순수 HTML/CSS/JS, `/*__DATA__*/` 자리에 데이터 주입).
  외부 라이브러리 의존 0(자체 force 시뮬레이션).
