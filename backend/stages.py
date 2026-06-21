# -*- coding: utf-8 -*-
"""플러그형 스테이지 어댑터 (§3.2) — M4.

각 파이프라인 스테이지(parser/skeleton/content)를 JSON-in / JSON-out 인터페이스로 추상화.
구현 2종:
  - ManualUploadStage : 지금. 수동 업로드 전용(실행 경로 없음).
  - ExternalScriptStage: 사내 외부 코드를 subprocess 로 호출(입력 JSON 경로 → 출력 JSON 경로).

불변(§6.4/§6.7): 스테이지 구현을 하드코딩하지 않는다(config 로 선택). 외부 출력은 *미신뢰* —
채택은 호출부에서 validate.py + store.commit 게이트를 통과해야만 한다(여기서는 산출만).
"""
from __future__ import annotations

import json
import shlex
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Protocol


class StageError(Exception):
    """스테이지 실행/산출 실패(비정상 종료·출력 없음·깨진 JSON 등)."""


class Stage(Protocol):
    kind: str
    def run(self, input_data: dict) -> dict: ...   # JSON-in → JSON-out


class ManualUploadStage:
    """지금 — 수동 업로드 경로(/ingest/upload)로만 채택. 실행 경로 없음."""
    kind = "manual"

    def run(self, input_data: dict) -> dict:
        raise StageError("manual 슬롯은 수동 업로드 전용입니다 (/ingest/upload).")


class ExternalScriptStage:
    """나중 — 사내 스크립트를 subprocess 로 호출.
    호출 규약: `<cmd...> <input_json_path> <output_json_path>`.
    스크립트는 input 을 읽고(필요시) 결과를 output_json_path 에 JSON 으로 쓴다.
    """
    kind = "external"

    def __init__(self, cmd: list[str], timeout: int = 60):
        self.cmd = cmd
        self.timeout = timeout

    def run(self, input_data: dict) -> dict:
        with tempfile.TemporaryDirectory() as d:
            ip = Path(d) / "in.json"
            op = Path(d) / "out.json"
            ip.write_text(json.dumps(input_data, ensure_ascii=False), encoding="utf-8")
            try:
                proc = subprocess.run(
                    [*self.cmd, str(ip), str(op)],
                    capture_output=True, text=True, timeout=self.timeout,
                )
            except subprocess.TimeoutExpired:
                raise StageError(f"스테이지 타임아웃({self.timeout}s)")
            except FileNotFoundError as e:
                raise StageError(f"실행 파일을 찾을 수 없음: {e}")
            if proc.returncode != 0:
                raise StageError(
                    f"비정상 종료(rc={proc.returncode}): {(proc.stderr or '').strip()[:300]}")
            if not op.exists():
                raise StageError("출력 JSON 파일이 생성되지 않음")
            raw = op.read_text(encoding="utf-8")
            try:
                return json.loads(raw)
            except json.JSONDecodeError as e:
                raise StageError(f"출력이 유효한 JSON 이 아님: {e}")


def parse_spec(spec: str) -> Stage:
    """config 스펙 문자열 → Stage. 'manual' | 'external:<cmd>'."""
    spec = (spec or "manual").strip()
    if spec == "manual":
        return ManualUploadStage()
    if spec.startswith("external:"):
        cmd = shlex.split(spec[len("external:"):].strip())
        if not cmd:
            raise StageError("external 스펙에 실행 cmd 가 없습니다")
        return ExternalScriptStage(cmd)
    raise StageError(f"알 수 없는 스테이지 스펙: {spec!r} (manual | external:<cmd>)")
