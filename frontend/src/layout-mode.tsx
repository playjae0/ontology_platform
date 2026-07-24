// 그래프 배치 설정 — Explore·Workbench 가 공유(동일 시각화). 분산형(force) 기본.
// "더 멀리": 레이아웃 정착 후 좌표를 중심에서 바깥으로 스케일(force 는 간격 옵션 미노출).
import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";

export type LayoutMode = "force" | "deterministic";
const WIDE_SPREAD = 1.8; // "더 멀리" 스케일 배수

interface Ctx {
  layoutMode: LayoutMode;
  setLayoutMode: (m: LayoutMode) => void;
  wide: boolean;
  setWide: (w: boolean) => void;
  spread: number; // GraphCanvas 로 넘길 좌표 스케일(1=기본)
}

const C = createContext<Ctx | null>(null);
export const useLayout = (): Ctx => {
  const v = useContext(C);
  if (!v) throw new Error("useLayout must be inside LayoutProvider");
  return v;
};

export function LayoutProvider({ children }: { children: ReactNode }) {
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("force"); // 기본 = 분산형
  const [wide, setWide] = useState(false);
  const spread = wide ? WIDE_SPREAD : 1;
  return (
    <C.Provider value={{ layoutMode, setLayoutMode, wide, setWide, spread }}>
      {children}
    </C.Provider>
  );
}

// Explore·Workbench 공용 배치 컨트롤(같은 컨텍스트라 두 화면 설정이 동기화).
export function LayoutControls() {
  const { layoutMode, setLayoutMode, wide, setWide } = useLayout();
  return (
    <div className="layout-bar">
      <span className="muted">배치</span>
      <div className="seg">
        <button className={layoutMode === "force" ? "on" : ""}
          onClick={() => setLayoutMode("force")}>분산형</button>
        <button className={layoutMode === "deterministic" ? "on" : ""}
          onClick={() => setLayoutMode("deterministic")}>계층형</button>
      </div>
      <button className={`spread-btn ${wide ? "on" : ""}`}
        title="노드를 더 멀리 벌린다"
        onClick={() => setWide(!wide)}>더 멀리{wide ? " ✓" : ""}</button>
    </div>
  );
}
