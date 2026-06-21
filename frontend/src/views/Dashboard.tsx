// 화면4 — 대시보드 (읽기 전용 현황). 기존 read path 재사용, 쓰기 없음.
import { useQuery } from "@tanstack/react-query";
import { fetchDashboard } from "../api";
import { categoryColor } from "../theme";
import { useBackend } from "../backend";

const REL_COLOR: Record<string, string> = {
  part_of: "#475569", precedes: "#0ea5e9", has_property: "#d97706",
};

export default function Dashboard() {
  const { backend, recordMs } = useBackend();
  const q = useQuery({
    queryKey: ["dashboard", backend],
    queryFn: async () => {
      const t = performance.now();
      const d = await fetchDashboard(backend);
      recordMs(backend, performance.now() - t);
      return d;
    },
  });
  if (q.isLoading) return <div className="dashboard"><p className="muted">집계 로딩…</p></div>;
  if (q.isError || !q.data)
    return <div className="dashboard"><p className="center-msg error">백엔드 연결 실패 (8077)</p></div>;
  const d = q.data;

  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const maxCov = Math.max(1, ...d.coverage.map((c) => c.nodes));

  return (
    <div className="dashboard">
      <div className="dash-grid">
        {/* 규모 */}
        <Card title="규모">
          <div className="dash-counters">
            <Stat v={d.scale.nodes} l="노드" />
            <Stat v={d.scale.edges} l="엣지" />
            <Stat v={d.scale.chunks} l="청크" />
            <Stat v={d.scale.describes} l="describes" />
          </div>
          <SubTitle>카테고리별 노드</SubTitle>
          <Bars data={Object.entries(d.scale.nodes_by_category)} colorFn={categoryColor} />
          <SubTitle>관계 타입별 엣지</SubTitle>
          <Bars data={Object.entries(d.scale.edges_by_relation)} colorFn={(k) => REL_COLOR[k] ?? "#94a3b8"} />
        </Card>

        {/* status 분포 */}
        <Card title="검수 상태 (proposed vs confirmed)">
          <StackBar
            segments={[
              { label: "confirmed", value: d.status.confirmed ?? 0, color: "#16a34a" },
              { label: "proposed", value: d.status.proposed ?? 0, color: "#f59e0b" },
            ]}
          />
          <p className="muted">검수 대기(proposed) {d.status.proposed ?? 0}건.</p>
        </Card>

        {/* 리뷰 큐 */}
        <Card title="리뷰 큐">
          <div className="dash-counters">
            <Stat v={d.review.queue_total} l="후보 총계" />
            <Stat v={d.review.orphans} l="구조적 고아" />
          </div>
          <SubTitle>종류별</SubTitle>
          {Object.keys(d.review.queue_by_kind).length === 0 ? (
            <p className="muted">큐 비어있음.</p>
          ) : (
            <Bars data={Object.entries(d.review.queue_by_kind)} colorFn={() => "#6366f1"} />
          )}
        </Card>

        {/* 공정별 커버리지 */}
        <Card title="공정별 커버리지 (어느 공정이 비었나)" wide>
          <table className="cov-table">
            <thead><tr><th>대공정</th><th>노드</th><th>청크</th><th>분포</th></tr></thead>
            <tbody>
              {d.coverage.map((c) => (
                <tr key={c.id}>
                  <td>{c.name} <span className="muted">{c.id}</span></td>
                  <td>{c.nodes}</td>
                  <td className={c.chunks === 0 ? "cov-empty" : ""}>{c.chunks}</td>
                  <td className="cov-bar-cell">
                    <div className="cov-bar" style={{ width: pct(c.nodes / maxCov), background: c.chunks === 0 ? "#fca5a5" : "#2563eb" }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">청크 0 = 근거 문서 미연결(빨강).</p>
        </Card>

        {/* 동의어 사전 flywheel */}
        <Card title="동의어 사전 (flywheel)">
          <Stat v={d.dictionary.aliases_total} l="누적 alias" big />
          <p className="muted">표면형 사전 — 검수가 쌓일수록 복리로 커지는 영속 자산.</p>
        </Card>

        {/* 건강 지표 */}
        <Card title="건강 지표">
          <Gauge label="unlinked 청크율" rate={d.health.unlinked_chunk_rate}
                 sub={`${d.health.unlinked_chunks}/${d.health.total_chunks} 청크`} />
          <Gauge label="orphan 노드율" rate={d.health.orphan_node_rate}
                 sub={`${d.health.orphan_nodes}/${d.health.unit_property_total} (Unit+Property)`} />
        </Card>
      </div>
    </div>
  );
}

function Card({ title, children, wide }: { title: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <section className={`dash-card ${wide ? "wide" : ""}`}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}
function Stat({ v, l, big }: { v: number; l: string; big?: boolean }) {
  return (
    <div className="dash-stat">
      <div className={big ? "dash-stat-v big" : "dash-stat-v"}>{v}</div>
      <div className="dash-stat-l">{l}</div>
    </div>
  );
}
function SubTitle({ children }: { children: React.ReactNode }) {
  return <div className="dash-subtitle">{children}</div>;
}
function Bars({ data, colorFn }: { data: [string, number][]; colorFn: (k: string) => string }) {
  const max = Math.max(1, ...data.map(([, v]) => v));
  return (
    <div className="dash-bars">
      {data.map(([k, v]) => (
        <div key={k} className="dash-bar-row">
          <span className="dash-bar-label">{k}</span>
          <div className="dash-bar-track">
            <div className="dash-bar-fill" style={{ width: `${(v / max) * 100}%`, background: colorFn(k) }} />
          </div>
          <span className="dash-bar-val">{v}</span>
        </div>
      ))}
    </div>
  );
}
function StackBar({ segments }: { segments: { label: string; value: number; color: string }[] }) {
  const total = Math.max(1, segments.reduce((s, x) => s + x.value, 0));
  return (
    <>
      <div className="stackbar">
        {segments.map((s) => (
          <div key={s.label} className="stackbar-seg" style={{ width: `${(s.value / total) * 100}%`, background: s.color }} title={`${s.label} ${s.value}`} />
        ))}
      </div>
      <div className="stackbar-legend">
        {segments.map((s) => (
          <span key={s.label}><i style={{ background: s.color }} />{s.label} {s.value}</span>
        ))}
      </div>
    </>
  );
}
function Gauge({ label, rate, sub }: { label: string; rate: number; sub: string }) {
  const danger = rate >= 0.5;
  return (
    <div className="gauge">
      <div className="gauge-head">
        <span>{label}</span>
        <strong className={danger ? "danger" : ""}>{Math.round(rate * 100)}%</strong>
      </div>
      <div className="dash-bar-track">
        <div className="dash-bar-fill" style={{ width: `${rate * 100}%`, background: danger ? "#dc2626" : "#16a34a" }} />
      </div>
      <div className="muted">{sub}</div>
    </div>
  );
}
