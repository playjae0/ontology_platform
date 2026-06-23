#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""원클릭 실행 런처 — 포트 충돌에 안전.

  python run.py            # 빌드된 프론트(frontend/dist)가 있으면 → 단일 포트(노드 불필요)
                           # 없으면 → dev 모드(백엔드 + Vite 동시, 노드 필요)
  python run.py --dev      # 강제 dev 모드
  python run.py --port N   # 백엔드 시작 포트 지정(차 있으면 다음 빈 포트 자동 탐색)

특징:
  - 백엔드 포트 자동 탐색(지정/기본 8077 부터 빈 포트). Vite 도 차 있으면 자동 증가.
  - CORS 는 localhost 모든 포트 허용 → 프론트 포트가 바뀌어도 안전.
  - 프로덕션 모드: 백엔드가 SPA 를 같은 포트로 서빙 → 노드/인터넷 불필요, Python 만.
  - Ctrl-C 로 종료(자식 프로세스 정리).
"""
from __future__ import annotations

import atexit
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
DIST = FRONTEND / "dist"

args = sys.argv[1:]
force_dev = "--dev" in args
start_port = 8077
if "--port" in args:
    try:
        start_port = int(args[args.index("--port") + 1])
    except (IndexError, ValueError):
        sys.exit("사용법: python run.py --port <번호>")


def free_port(start: int) -> int:
    """start 부터 빈 TCP 포트를 찾아 반환(최대 200개 시도)."""
    p = start
    for _ in range(200):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(("127.0.0.1", p)) != 0:  # 연결 실패 = 비어있음
                return p
        p += 1
    sys.exit(f"{start}~{start + 200} 범위에 빈 포트가 없습니다.")


def check_backend_deps() -> None:
    try:
        import fastapi  # noqa: F401
        import uvicorn  # noqa: F401
    except ImportError:
        sys.exit("백엔드 의존성 없음 → 먼저:  pip install --break-system-packages fastapi uvicorn\n"
                 "(Neo4j 백엔드까지 쓰려면 neo4j 도 함께. 기본 동작엔 불필요.)")


procs: list[subprocess.Popen] = []


@atexit.register
def _cleanup():
    for p in procs:
        try:
            p.terminate()
        except Exception:
            pass


def main() -> None:
    check_backend_deps()
    port = free_port(start_port)
    if port != start_port:
        print(f"  (포트 {start_port} 사용 중 → 빈 포트 {port} 사용)")

    prod = DIST.exists() and not force_dev
    env = {**os.environ}

    if prod:
        # 단일 포트: 백엔드가 SPA(dist)까지 서빙. 노드 불필요.
        procs.append(subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "app:app", "--port", str(port),
             "--host", "0.0.0.0"], cwd=str(BACKEND), env=env))
        time.sleep(1.5)
        print("\n" + "=" * 56, flush=True)
        print("  온톨로지 관리소 — 단일 포트 모드 (Python 만)")
        print(f"  브라우저: http://localhost:{port}", flush=True)
        print("  종료: Ctrl-C")
        print("=" * 56 + "\n", flush=True)
    else:
        # dev: 백엔드 + Vite. 프론트는 VITE_API_BASE 로 백엔드 주소 주입.
        if not (FRONTEND / "node_modules").exists():
            print("  프론트 의존성 설치(npm install)… (인터넷/프록시 필요, 1회)")
            npm = "npm.cmd" if os.name == "nt" else "npm"
            subprocess.run([npm, "install"], cwd=str(FRONTEND), check=True)
        procs.append(subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "app:app", "--port", str(port)],
            cwd=str(BACKEND), env=env))
        fenv = {**env, "VITE_API_BASE": f"http://localhost:{port}"}
        npm = "npm.cmd" if os.name == "nt" else "npm"
        procs.append(subprocess.Popen(
            [npm, "run", "dev"], cwd=str(FRONTEND), env=fenv,
            shell=(os.name == "nt")))
        print("\n" + "=" * 56, flush=True)
        print("  온톨로지 관리소 — dev 모드")
        print(f"  백엔드: http://localhost:{port}", flush=True)
        print("  프론트: Vite 가 출력하는 주소(보통 5173, 차면 자동 증가)로 접속")
        print("  종료: Ctrl-C")
        print("=" * 56 + "\n", flush=True)

    try:
        while True:
            time.sleep(1)
            if any(p.poll() is not None for p in procs):
                break
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
