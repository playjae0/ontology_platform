# -*- coding: utf-8 -*-
"""SSOT 쓰기 관리 (§7 M2) — 채택(replace) + 백업 + SSOT 재검증 + 자동 롤백.

데이터 디렉토리 분리(§8):
  current/   작업 SSOT (읽기·쓰기 대상)
  mock/      원본 mock (절대 안 씀; reset-mock 의 복원원)
  _backup/   덮어쓰기 전 직전 스냅샷(타임스탬프 폴더). 롤백 1단계.

불변 원칙: 모든 쓰기는 JSON 파일에만(§6.3). 업로드≠승인(§6.9) — 여기서는 SSOT 로딩만,
status 는 입력값을 보존(proposed 는 proposed 로 남아 M3 승인 대상).
"""
from __future__ import annotations

import json
import os
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any

import validate

# 스테이지 슬롯(§3.2). 산출물 → ingest 슬롯 매핑(§5).
STAGE_SLOTS = ("parser", "skeleton", "content")
STAGE_TO_INGEST = {"parser": "chunks", "skeleton": "skeleton", "content": "contents"}
STAGE_CONFIG_FILE = "stage_config.json"

# slot → 파일명
SLOT_FILE = {
    "skeleton": "assembly_skeleton.json",
    "contents": "contents.json",
    "chunks": "chunks.json",
}
QUEUE_FILE = "review_queue.json"  # 리뷰 큐(파이프라인 산출물; M3 승인 대상)


class Store:
    def __init__(self, data_root: Path):
        self.root = Path(data_root)
        self.current = self.root / "current"
        self.mock = self.root / "mock"
        self.backup = self.root / "_backup"
        self.current.mkdir(parents=True, exist_ok=True)
        self.backup.mkdir(parents=True, exist_ok=True)
        # SSOT(JSON) 변경 후 호출되는 훅 — Neo4j 파생 캐시 재생성 등(§6.3)
        self.on_change = None
        self._ensure_seeded()

    def _notify(self) -> None:
        if self.on_change:
            try:
                self.on_change()
            except Exception:
                pass  # 파생 캐시 재생성 실패가 SSOT 쓰기를 막지 않는다

    # ---- 경로/로딩 ----
    def _path(self, slot: str) -> Path:
        return self.current / SLOT_FILE[slot]

    def _ensure_seeded(self) -> None:
        """current 가 비어있으면 mock 으로 시드(최초 기동)."""
        for fname in (SLOT_FILE["skeleton"], SLOT_FILE["contents"], QUEUE_FILE):
            dst = self.current / fname
            src = self.mock / fname
            if not dst.exists() and src.exists():
                shutil.copy2(src, dst)

    def _read(self, slot: str) -> Any | None:
        p = self._path(slot)
        if not p.exists():
            return None
        return json.loads(p.read_text(encoding="utf-8"))

    def load_skeleton(self) -> Any:
        return self._read("skeleton") or {"nodes": {}, "edges": []}

    def load_contents(self) -> Any:
        return self._read("contents") or {"chunks": [], "describes": []}

    def load_queue(self) -> dict:
        p = self.current / QUEUE_FILE
        if not p.exists():
            return {"items": []}
        d = json.loads(p.read_text(encoding="utf-8"))
        return {"items": d.get("items", [])}

    def commit(self, *, skeleton: Any = None, contents: Any = None,
               queue: Any = None) -> dict:
        """변이 커밋(M3/M5) — 백업 → 쓰기 → **전체 재검증** → 깨지면 자동 롤백.

        전체 재검증 = 스키마(validate_slot) + 참조 무결성(slot 내부 + 교차-slot).
        엣지의 source/target ∈ nodes 같은 구조 무결성도 여기서 잡혀 롤백된다(M5 가드레일).
        리뷰 큐는 파이프라인 산출물이라 검증 대상 아님.
        """
        self._snapshot()
        if skeleton is not None:
            (self.current / SLOT_FILE["skeleton"]).write_text(
                json.dumps(skeleton, ensure_ascii=False, indent=2), encoding="utf-8")
        if contents is not None:
            (self.current / SLOT_FILE["contents"]).write_text(
                json.dumps(contents, ensure_ascii=False, indent=2), encoding="utf-8")
        if queue is not None:
            (self.current / QUEUE_FILE).write_text(
                json.dumps(queue, ensure_ascii=False, indent=2), encoding="utf-8")

        sk, ct = self.load_skeleton(), self.load_contents()
        errors = (validate.validate_slot("skeleton", sk)
                  + validate.validate_slot("contents", ct)
                  + validate.validate_ssot(sk, ct))
        if errors:
            self.rollback()
            return {"ok": False, "errors": errors,
                    "warning": "변이 후 검증 실패 → 자동 롤백됨"}
        self._notify()
        return {"ok": True}

    # ---- 백업/롤백 ----
    def _snapshot(self) -> str:
        """현 current 전체를 _backup/<ts>/ 로 복사. 반환: ts."""
        ts = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
        dst = self.backup / ts
        dst.mkdir(parents=True)
        for f in self.current.glob("*.json"):
            shutil.copy2(f, dst / f.name)
        return ts

    def _backup_stack(self) -> list[Path]:
        return sorted([d for d in self.backup.iterdir() if d.is_dir()])

    def _restore(self, snap: Path) -> None:
        for f in self.current.glob("*.json"):
            f.unlink()
        for f in snap.glob("*.json"):
            shutil.copy2(f, self.current / f.name)

    def rollback(self) -> dict:
        """직전 백업으로 1단계 복원."""
        stack = self._backup_stack()
        if not stack:
            return {"ok": False, "msg": "복원할 백업이 없습니다."}
        latest = stack[-1]
        self._restore(latest)
        shutil.rmtree(latest)  # 1단계 소비
        self._notify()
        return {"ok": True, "restored_from": latest.name}

    def reset_mock(self) -> dict:
        """mock 으로 복원(직전 상태는 백업)."""
        self._snapshot()
        for f in self.current.glob("*.json"):
            f.unlink()
        for f in self.mock.glob("*.json"):
            shutil.copy2(f, self.current / f.name)
        self._ensure_seeded()
        self._notify()
        return {"ok": True}

    # ---- 채택 ----
    def upload(self, slot: str, data: Any, adopt: bool) -> dict:
        """검증(adopt=False) 또는 검증+채택(adopt=True).

        채택 = replace(merge 없음). 채택 후 SSOT 전체 재검증; 깨지면 자동 롤백.
        """
        if slot not in SLOT_FILE:
            return {"valid": False,
                    "errors": [{"path": "slot", "msg": f"알 수 없는 slot '{slot}'"}],
                    "adopted": False}

        errors = validate.validate_slot(slot, data)
        if errors:
            return {"valid": False, "errors": errors, "adopted": False}

        counts = _count_slot(slot, data)
        if not adopt:
            return {"valid": True, "errors": [], "adopted": False, "counts": counts}

        # 채택: 백업 → 쓰기 → SSOT 재검증 → 깨지면 롤백
        self._snapshot()
        self._path(slot).write_text(
            json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

        ssot_errors = validate.validate_ssot(self.load_skeleton(), self.load_contents())
        if ssot_errors:
            self.rollback()  # 방금 만든 스냅샷으로 복원 + 소비
            return {"valid": True, "adopted": False, "errors": [],
                    "ssot_errors": ssot_errors,
                    "warning": "채택 후 SSOT 교차검증 실패 → 자동 롤백됨"}
        self._notify()
        return {"valid": True, "adopted": True, "errors": [], "counts": counts}

    # ---- 상태 ----
    # ---- 스테이지 config (§3.2/M4) ----
    def load_stage_config(self) -> dict:
        """슬롯별 스테이지 스펙. 우선순위: 파일 > 환경변수(STAGE_<SLOT>) > 'manual'."""
        cfg = {s: "manual" for s in STAGE_SLOTS}
        for s in STAGE_SLOTS:
            env = os.environ.get(f"STAGE_{s.upper()}")
            if env:
                cfg[s] = env
        p = self.root / STAGE_CONFIG_FILE
        if p.exists():
            try:
                data = json.loads(p.read_text(encoding="utf-8"))
                cfg.update({k: v for k, v in data.items() if k in STAGE_SLOTS})
            except Exception:
                pass
        return cfg

    def save_stage_config(self, cfg: dict) -> dict:
        clean = {s: str(cfg.get(s, "manual")) for s in STAGE_SLOTS}
        (self.root / STAGE_CONFIG_FILE).write_text(
            json.dumps(clean, ensure_ascii=False, indent=2), encoding="utf-8")
        return clean

    def slots_status(self) -> dict:
        out = {}
        for slot, fname in SLOT_FILE.items():
            p = self.current / fname
            out[slot] = {
                "present": p.exists(),
                "adopted_at": (datetime.fromtimestamp(p.stat().st_mtime).isoformat()
                               if p.exists() else None),
            }
        return {
            "slots": out,
            "backups": len(self._backup_stack()),
            "can_rollback": len(self._backup_stack()) > 0,
        }


def _count_slot(slot: str, data: Any) -> dict:
    if slot == "skeleton":
        nodes = data.get("nodes", {})
        n = len(nodes) if isinstance(nodes, (dict, list)) else 0
        return {"nodes": n, "edges": len(data.get("edges", []))}
    if slot == "contents":
        return {"chunks": len(data.get("chunks", [])),
                "describes": len(data.get("describes", []))}
    if slot == "chunks":
        return {"chunks": len(data.get("chunks", []))}
    return {}
