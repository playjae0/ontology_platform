// 화면1 — 데이터 관리 + 수동 주입 (§4 M2) + 스테이지 슬롯 (M4).
import { useState } from "react";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { fetchStatus, rollback, resetMock, fetchStageConfig, runStage } from "../api";
import SlotUpload from "../components/SlotUpload";
import type { Slot } from "../api";

const SLOTS: { slot: Slot; label: string; hint: string }[] = [
  { slot: "skeleton", label: "뼈대 (assembly_skeleton)", hint: "노드(Process/Unit/Property) + 엣지(part_of/precedes/has_property)" },
  { slot: "contents", label: "콘텐츠 (contents)", hint: "청크 + describes(청크→노드). describes.target 은 현 SSOT 노드여야 함." },
  { slot: "chunks", label: "청크 (parsing 출력)", hint: "doc_id + chunks[]. 파싱 스테이지 출력 형식." },
];

export default function DataManage() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["status"], queryFn: fetchStatus });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["status"] });
    qc.invalidateQueries({ queryKey: ["graph"] });
    qc.invalidateQueries({ queryKey: ["node"] });
  };

  const rollbackMut = useMutation({ mutationFn: rollback, onSuccess: invalidateAll });
  const resetMut = useMutation({ mutationFn: resetMock, onSuccess: invalidateAll });

  const s = status.data;

  return (
    <div className="data-manage">
      <section className="dm-status">
        <h2>현재 SSOT 상태</h2>
        {s && (
          <>
            <div className="status-counts">
              <Counter label="노드" v={s.counts.nodes} />
              <Counter label="엣지" v={s.counts.edges} />
              <Counter label="청크" v={s.counts.chunks} />
              <Counter label="describes" v={s.counts.describes} />
            </div>
            <table className="slot-table">
              <thead>
                <tr><th>slot</th><th>상태</th><th>최종 채택</th></tr>
              </thead>
              <tbody>
                {Object.entries(s.slots).map(([slot, info]) => (
                  <tr key={slot}>
                    <td><code>{slot}</code></td>
                    <td>{info.present ? "✓ 로드됨" : "— 없음"}</td>
                    <td className="muted">
                      {info.adopted_at ? new Date(info.adopted_at).toLocaleString() : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="dm-ops">
              <button
                disabled={!s.can_rollback || rollbackMut.isPending}
                onClick={() => rollbackMut.mutate()}
                title={s.can_rollback ? "" : "복원할 백업이 없습니다"}
              >
                직전 롤백 (백업 {s.backups})
              </button>
              <button onClick={() => resetMut.mutate()} disabled={resetMut.isPending}>
                mock 리셋
              </button>
              {rollbackMut.data && !rollbackMut.data.ok && (
                <span className="result-bad">{rollbackMut.data.msg}</span>
              )}
            </div>
          </>
        )}
      </section>

      <section className="dm-inject">
        <h2>수동 JSON 주입</h2>
        <p className="muted">
          업로드 ≠ 승인. 채택은 테스트/부트스트랩용 SSOT 로딩이며, <code>proposed</code> 노드는
          이후 검수(M3) 승인 대상으로 남습니다.
        </p>
        <div className="slot-grid">
          {SLOTS.map((c) => (
            <SlotUpload key={c.slot} {...c} onAdopted={invalidateAll} />
          ))}
        </div>
      </section>

      <StageSlots onChanged={invalidateAll} />
    </div>
  );
}

function StageSlots({ onChanged }: { onChanged: () => void }) {
  const cfg = useQuery({ queryKey: ["stageConfig"], queryFn: fetchStageConfig });
  const [msg, setMsg] = useState<string | null>(null);
  const runMut = useMutation({
    mutationFn: (slot: string) => runStage(slot),
    onSuccess: (r) => {
      onChanged();
      const a = r as { adopted?: boolean };
      setMsg(a.adopted ? "✓ 외부 스테이지 실행 → 채택됨" : "실행됨(채택 안 됨 — 검증 확인)");
    },
    onError: (e) => setMsg(`✗ ${String(e)}`),
  });

  return (
    <section className="dm-stages">
      <h2>스테이지 슬롯 (M4)</h2>
      <p className="muted">
        파이프라인 스테이지를 config 로 선택. <code>manual</code> = 수동 업로드 전용,{" "}
        <code>external:&lt;cmd&gt;</code> = 사내 스크립트 subprocess. 외부 출력도 검증 게이트로만 채택.
      </p>
      <div className="stage-row">
        {(["parser", "skeleton", "content"] as const).map((name) => {
          const spec = cfg.data?.[name] ?? "manual";
          const isExternal = spec.startsWith("external:");
          return (
            <div key={name} className="stage-chip">
              <strong>{name}</strong>
              {isExternal ? (
                <>
                  <span className="badge-ext" title={spec}>external</span>
                  <button
                    className="stage-run"
                    disabled={runMut.isPending}
                    onClick={() => { setMsg(null); runMut.mutate(name); }}
                  >
                    실행
                  </button>
                </>
              ) : (
                <>
                  <span className="badge-active">수동 업로드</span>
                  <span className="badge-stub" title="config 로 external 설정 시 실행 활성">실행 (manual)</span>
                </>
              )}
            </div>
          );
        })}
      </div>
      {msg && <div className={msg.startsWith("✓") ? "result-ok" : msg.startsWith("✗") ? "result-bad" : "result-warn"}>{msg}</div>}
    </section>
  );
}

function Counter({ label, v }: { label: string; v: number }) {
  return (
    <div className="counter-box">
      <div className="counter-v">{v}</div>
      <div className="counter-l">{label}</div>
    </div>
  );
}
