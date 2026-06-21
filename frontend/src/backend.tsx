// 백엔드 토글(JSON ⇄ Neo4j) — 진단용. 읽기 전용: 같은 데이터, 차이는 속도뿐(§6.3).
import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { fetchNeo4jStatus, syncNeo4j } from "./api";

export type Backend = "json" | "neo4j";

interface Ctx {
  backend: Backend;
  setBackend: (b: Backend) => void;
  neo4jActive: boolean;
  neo4jUnavailable: boolean;
  activateNeo4j: () => Promise<boolean>;
  lastMs: Partial<Record<Backend, number>>;
  recordMs: (b: Backend, ms: number) => void;
}

const C = createContext<Ctx | null>(null);
export const useBackend = (): Ctx => {
  const v = useContext(C);
  if (!v) throw new Error("useBackend must be inside BackendProvider");
  return v;
};

export function BackendProvider({ children }: { children: ReactNode }) {
  const [backend, setBackend] = useState<Backend>("json");
  const [neo4jActive, setActive] = useState(false);
  const [neo4jUnavailable, setUnavailable] = useState(false);
  const [lastMs, setLast] = useState<Partial<Record<Backend, number>>>({});

  useEffect(() => {
    fetchNeo4jStatus().then((s) => setActive(!!s.active)).catch(() => {});
  }, []);

  const recordMs = (b: Backend, ms: number) =>
    setLast((p) => ({ ...p, [b]: Math.round(ms) }));

  const activateNeo4j = async (): Promise<boolean> => {
    try {
      await syncNeo4j(); // 현 SSOT → Neo4j 재생성·활성화
      setActive(true);
      setUnavailable(false);
      return true;
    } catch {
      setUnavailable(true);
      setActive(false);
      setBackend("json"); // 미가동 → json fallback
      return false;
    }
  };

  return (
    <C.Provider value={{ backend, setBackend, neo4jActive, neo4jUnavailable, activateNeo4j, lastMs, recordMs }}>
      {children}
    </C.Provider>
  );
}

export function BackendToggle() {
  const { backend, setBackend, neo4jActive, neo4jUnavailable, activateNeo4j, lastMs } = useBackend();
  const ms = lastMs[backend];

  return (
    <div className="backend-toggle">
      <span className="bt-label">데이터 소스</span>
      <div className="bt-seg">
        <button className={backend === "json" ? "on" : ""} onClick={() => setBackend("json")}>
          JSON
        </button>
        <button
          className={`${backend === "neo4j" ? "on" : ""} ${neo4jUnavailable ? "disabled" : ""}`}
          disabled={neo4jUnavailable}
          title={neo4jUnavailable ? "Neo4j 미가동 — JSON 으로 동작" : neo4jActive ? "" : "클릭 시 현 SSOT 적재"}
          onClick={async () => {
            if (neo4jActive) { setBackend("neo4j"); return; }
            if (await activateNeo4j()) setBackend("neo4j");
          }}
        >
          Neo4j{neo4jUnavailable ? " (미가동)" : !neo4jActive ? " (적재)" : ""}
        </button>
      </div>
      <span className="bt-ms" data-backend={backend}>
        {ms != null ? `${backend === "neo4j" ? "Neo4j" : "JSON"} · ${ms}ms` : "—"}
      </span>
    </div>
  );
}
