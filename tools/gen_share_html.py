#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""현재 SSOT(data/current) 를 임베드한 '단독 공유용 HTML' 생성.

흐름:
  ① '데이터 관리 > 수동 JSON 주입' 으로 실데이터 JSON 을 넣으면 data/current 에 반영된다.
  ② 이 스크립트를 돌리면 그 데이터가 그대로 박힌 HTML 한 파일이 나온다.
  ③ 그 파일만 공유하면(이메일·드라이브·사내망) 누구나 브라우저로 더블클릭해 연다.
     서버·인터넷·설치 전부 불필요(자체완결). 임베딩은 절대 포함하지 않음(§6.2).

사용:
  python tools/gen_share_html.py                        # data/current → ontology_share.html
  python tools/gen_share_html.py --out 공유본.html
  python tools/gen_share_html.py --data data/mock       # 다른 데이터 폴더로
  python tools/gen_share_html.py --skeleton a.json --contents b.json   # 파일 직접 지정
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
TEMPLATE = pathlib.Path(__file__).resolve().parent / "share_template.html"


def load(skeleton: str, contents: str) -> dict:
    sk = json.loads(pathlib.Path(skeleton).read_text(encoding="utf-8"))
    cpath = pathlib.Path(contents)
    co = json.loads(cpath.read_text(encoding="utf-8")) if cpath.exists() else {"chunks": [], "describes": []}
    nd = sk.get("nodes", {})
    nd = nd if isinstance(nd, dict) else {n["id"]: n for n in nd}  # JsonReader 처럼 list/dict 수용

    def doc_of(n: dict) -> str:
        prov = n.get("provenance") or []
        return prov[0].get("doc_id", "") if prov and isinstance(prov[0], dict) else ""

    nodes = [{
        "id": nid, "name": n.get("canonical_name", nid), "cat": n.get("category", ""),
        "status": n.get("status", "confirmed"), "def": n.get("definition") or "",
        "aliases": n.get("aliases") or [], "spec": n.get("spec"),
        "attached_to": n.get("attached_to"), "doc": doc_of(n),
    } for nid, n in nd.items()]  # embedding 필드는 옮기지 않는다(§6.2)
    links = [{"s": e["source"], "r": e["relation"], "t": e["target"], "st": e.get("status", "confirmed")}
             for e in sk.get("edges", [])]
    chunks = [{"cid": c.get("cid"), "doc": c.get("doc_id", ""), "section": c.get("section", ""),
               "text": c.get("text", ""), "meta": c.get("meta", {})} for c in co.get("chunks", [])]
    describes = [{"s": d["source"], "t": d["target"]} for d in co.get("describes", [])]
    return {"nodes": nodes, "links": links, "chunks": chunks, "describes": describes}


def wrap_full_document(content: str) -> str:
    """content-only 템플릿(<title>+<style>+markup+<script>) 을 완결 HTML 문서로 감싼다.
    <head> 에 title/style, <body> 에 나머지 — 더블클릭 공유에 안전(meta charset 포함)."""
    marker = "</style>"
    i = content.find(marker)
    if i < 0:
        return content
    head = content[: i + len(marker)]
    body = content[i + len(marker):]
    return (
        "<!doctype html>\n<html lang=\"ko\">\n<head>\n"
        "<meta charset=\"utf-8\">\n"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n"
        + head + "\n</head>\n<body>\n" + body + "\n</body>\n</html>\n"
    )


def main() -> None:
    ap = argparse.ArgumentParser(description="현재 SSOT → 단독 공유용 HTML")
    ap.add_argument("--data", default=str(ROOT / "data" / "current"), help="데이터 폴더(기본 data/current)")
    ap.add_argument("--skeleton", help="assembly_skeleton.json 경로 직접 지정")
    ap.add_argument("--contents", help="contents.json 경로 직접 지정")
    ap.add_argument("--out", default=str(ROOT / "ontology_share.html"), help="출력 HTML 경로")
    a = ap.parse_args()

    sk = a.skeleton or str(pathlib.Path(a.data) / "assembly_skeleton.json")
    co = a.contents or str(pathlib.Path(a.data) / "contents.json")
    if not pathlib.Path(sk).exists():
        sys.exit(f"스켈레톤 JSON 이 없습니다: {sk}\n"
                 f"('데이터 관리'에서 주입 후 실행하거나 --skeleton 로 경로를 지정하세요.)")
    if not TEMPLATE.exists():
        sys.exit(f"템플릿이 없습니다: {TEMPLATE}")

    data = load(sk, co)
    tpl = TEMPLATE.read_text(encoding="utf-8")
    html = wrap_full_document(tpl).replace(
        "/*__DATA__*/", "const DATA = " + json.dumps(data, ensure_ascii=False) + ";")
    pathlib.Path(a.out).write_text(html, encoding="utf-8")

    print(f"생성: {a.out}")
    print(f"  노드 {len(data['nodes'])} · 엣지 {len(data['links'])} · "
          f"청크 {len(data['chunks'])} · describes {len(data['describes'])}")
    print("  → 이 파일 하나만 공유하면 브라우저로 바로 열립니다(서버·인터넷 불필요).")


if __name__ == "__main__":
    main()
