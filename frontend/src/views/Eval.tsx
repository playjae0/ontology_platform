// 화면6 — Test/Eval (M11). 검색(retrieval) + 골든셋 평가. 읽기 전용·임베딩 미사용.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { fetchGolden, runEval, retrieve } from "../api";
import type { EvalResult, RetrieveResult } from "../api";

export default function Eval() {
  const [k, setK] = useState(5);
  const [result, setResult] = useState<EvalResult | null>(null);
  const golden = useQuery({ queryKey: ["golden"], queryFn: fetchGolden });
  const runM = useMutation({ mutationFn: () => runEval(k), onSuccess: setResult });

  return (
    <div className="eval">
      <section className="eval-band">
        <div className="eval-head">
          <h2>골든셋 평가 (Recall@k · MRR)</h2>
          <div className="btn-row">
            <label className="muted">k <input type="number" min={1} max={10} value={k}
              onChange={(e) => setK(Math.max(1, +e.target.value))} style={{ width: 48 }} /></label>
            <button className="primary" disabled={runM.isPending} onClick={() => runM.mutate()}>
              평가 실행 ({golden.data?.items.length ?? 0}문항)
            </button>
          </div>
        </div>
        <p className="muted">
          검색 = 별칭+렉시컬 링킹 → part_of/has_property 탐색 → describes 청크 수집. <b>임베딩 미사용</b> —
          mock 에서도 Recall 의미있음. 미해소(alias gap)는 임베딩-보강(사내 확장) 신호.
        </p>

        {result && (
          <>
            <div className="eval-metrics">
              <Metric label={`Recall@${result.summary.k}`} v={pct(result.summary.recall_at_k)} good={result.summary.recall_at_k >= 0.8} />
              <Metric label="MRR" v={result.summary.mrr.toFixed(3)} good={result.summary.mrr >= 0.8} />
              <Metric label="문항" v={String(result.summary.n)} />
              <Metric label="alias gap" v={String(result.summary.gaps.length)} good={result.summary.gaps.length === 0} warn />
            </div>
            <h4>패턴별 Recall</h4>
            <div className="dash-bars">
              {Object.entries(result.summary.by_pattern).map(([p, v]) => (
                <div key={p} className="dash-bar-row">
                  <span className="dash-bar-label" title={p}>{p}</span>
                  <div className="dash-bar-track"><div className="dash-bar-fill" style={{ width: pct(v), background: v >= 0.8 ? "#16a34a" : "#f59e0b" }} /></div>
                  <span className="dash-bar-val">{pct(v)}</span>
                </div>
              ))}
            </div>
            {result.summary.gaps.length > 0 && (
              <div className="orphan-box">
                <div className="rel-title">미해소 (alias gap) — 임베딩-보강 필요</div>
                {result.summary.gaps.map((g) => <div key={g.id} className="muted">· {g.id} {g.question}</div>)}
              </div>
            )}
          </>
        )}
      </section>

      <section className="eval-band">
        <h3>골든셋 {result ? "결과" : ""}</h3>
        <table className="batch-table">
          <thead><tr><th>id</th><th>질문</th><th>패턴</th><th>난이도</th>{result && <><th>Recall</th><th>rank</th><th>해소</th></>}</tr></thead>
          <tbody>
            {(golden.data?.items ?? []).map((g) => {
              const r = result?.items.find((x) => x.id === g.id);
              return (
                <tr key={g.id}>
                  <td><code>{g.id}</code></td>
                  <td>{g.question}</td>
                  <td><span className="kind-badge">{g.query_pattern}</span></td>
                  <td className="muted">{g.difficulty}</td>
                  {result && (
                    <>
                      <td className={r && r.recall < 1 ? "cov-empty" : ""}>{r ? r.recall : "-"}</td>
                      <td>{r?.rank || "-"}</td>
                      <td>{r ? (r.resolved ? "✓" : "gap") : "-"}</td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <AskBox />
    </div>
  );
}

function AskBox() {
  const [q, setQ] = useState("stack alignment 관리값");
  const [res, setRes] = useState<RetrieveResult | null>(null);
  const askM = useMutation({ mutationFn: () => retrieve(q, 5), onSuccess: setRes });
  return (
    <section className="eval-band">
      <h3>온톨로지에 질문하기 (검색)</h3>
      <div className="btn-row">
        <input className="search-input" style={{ flex: 1 }} value={q}
          onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && askM.mutate()} />
        <button onClick={() => askM.mutate()}>검색</button>
      </div>
      {res && (
        <div className="ask-result">
          <div className="muted">
            링킹: {res.linked_nodes.length === 0 ? <span className="cov-empty">미해소 (alias gap)</span>
              : res.linked_nodes.map((n) => <span key={n.id} className="badge-active" style={{ marginRight: 4 }}>{n.name}({n.matched})</span>)}
          </div>
          {res.chunks.map((c) => (
            <div key={c.cid} className="chunk-card">
              <div className="chunk-meta">{c.cid} · {c.section} · score {c.score}</div>
              <div className="chunk-text">{c.text}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Metric({ label, v, good, warn }: { label: string; v: string; good?: boolean; warn?: boolean }) {
  return (
    <div className="counter-box">
      <div className="counter-v" style={{ color: good === undefined ? undefined : good ? "#16a34a" : warn ? "#b45309" : "#dc2626" }}>{v}</div>
      <div className="counter-l">{label}</div>
    </div>
  );
}
const pct = (n: number) => `${Math.round(n * 100)}%`;
