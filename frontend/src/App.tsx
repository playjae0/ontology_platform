// 앱 셸 — 화면 전환(Explore ↔ 데이터 관리) + 상단 카운트.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchStatus } from "./api";
import Explore from "./views/Explore";
import DataManage from "./views/DataManage";
import Workbench from "./views/Workbench";
import "./App.css";

type View = "explore" | "workbench" | "data";

export default function App() {
  const [view, setView] = useState<View>("explore");
  const status = useQuery({ queryKey: ["status"], queryFn: fetchStatus });

  return (
    <div className="app">
      <header className="topbar">
        <strong>온톨로지 관리소</strong>
        <nav className="nav">
          <button className={view === "explore" ? "active" : ""} onClick={() => setView("explore")}>
            Explore
          </button>
          <button className={view === "workbench" ? "active" : ""} onClick={() => setView("workbench")}>
            검수 Workbench
          </button>
          <button className={view === "data" ? "active" : ""} onClick={() => setView("data")}>
            데이터 관리
          </button>
        </nav>
        {status.data && (
          <span className="topbar-counts">
            노드 {status.data.counts.nodes} · 엣지 {status.data.counts.edges} · 청크{" "}
            {status.data.counts.chunks}
          </span>
        )}
      </header>

      {view === "explore" && <Explore />}
      {view === "workbench" && <Workbench />}
      {view === "data" && <DataManage />}
    </div>
  );
}
