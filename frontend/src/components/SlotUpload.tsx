// 단일 slot 수동 주입 카드 (§4 화면1) — 파일/붙여넣기 → [검증] → 결과 → [채택].
// 업로드 ≠ 승인(§6.9): 채택은 SSOT 로딩일 뿐, proposed 는 M3 승인 대상으로 남는다.
import { useState } from "react";
import { uploadSlot } from "../api";
import type { Slot, UploadResult } from "../api";

interface Props {
  slot: Slot;
  label: string;
  hint: string;
  onAdopted: () => void;
}

export default function SlotUpload({ slot, label, hint, onAdopted }: Props) {
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<unknown>(null);
  const [parseErr, setParseErr] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [busy, setBusy] = useState(false);

  function ingest(raw: string) {
    setText(raw);
    setResult(null);
    if (!raw.trim()) {
      setParsed(null);
      setParseErr(null);
      return;
    }
    try {
      setParsed(JSON.parse(raw));
      setParseErr(null);
    } catch (e) {
      setParsed(null);
      setParseErr(`JSON 파싱 실패: ${(e as Error).message}`);
    }
  }

  async function onFile(file: File) {
    ingest(await file.text());
  }

  async function run(adopt: boolean) {
    if (parsed == null) return;
    setBusy(true);
    try {
      const r = await uploadSlot(slot, parsed, adopt);
      setResult(r);
      if (r.adopted) {
        onAdopted();
        setText("");
        setParsed(null);
      }
    } catch (e) {
      setResult({ valid: false, adopted: false, errors: [{ path: "$", msg: String(e) }] });
    } finally {
      setBusy(false);
    }
  }

  const canValidate = parsed != null && !busy;

  return (
    <div className="slot-card">
      <div className="slot-head">
        <h3>{label}</h3>
        <span className="slot-tag">slot: {slot}</span>
      </div>
      <p className="muted slot-hint">{hint}</p>

      <div
        className="dropzone"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files[0];
          if (f) onFile(f);
        }}
      >
        JSON 파일을 끌어다 놓거나
        <label className="file-link">
          파일 선택
          <input
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
          />
        </label>
      </div>

      <textarea
        className="slot-textarea"
        placeholder="또는 JSON 붙여넣기…"
        value={text}
        onChange={(e) => ingest(e.target.value)}
        spellCheck={false}
      />

      {parseErr && <div className="result-bad">⚠ {parseErr}</div>}

      <div className="slot-actions">
        <button disabled={!canValidate} onClick={() => run(false)}>
          검증
        </button>
        <button
          className="primary"
          disabled={!canValidate || !result?.valid}
          title={result?.valid ? "" : "먼저 검증을 통과해야 채택할 수 있습니다"}
          onClick={() => run(true)}
        >
          채택 (replace)
        </button>
      </div>

      {result && <ResultView result={result} />}
    </div>
  );
}

function ResultView({ result }: { result: UploadResult }) {
  if (result.adopted) {
    return (
      <div className="result-ok">
        ✓ 채택됨 — SSOT 갱신.{" "}
        {result.counts && (
          <span className="muted">
            ({Object.entries(result.counts).map(([k, v]) => `${k} ${v}`).join(" · ")})
          </span>
        )}
      </div>
    );
  }
  if (result.ssot_errors) {
    return (
      <div className="result-bad">
        <strong>⚠ {result.warning ?? "SSOT 교차검증 실패 → 자동 롤백"}</strong>
        <ErrorList errors={result.ssot_errors} />
      </div>
    );
  }
  if (result.valid) {
    return (
      <div className="result-ok">
        ✓ 검증 통과 — [채택] 가능.{" "}
        {result.counts && (
          <span className="muted">
            ({Object.entries(result.counts).map(([k, v]) => `${k} ${v}`).join(" · ")})
          </span>
        )}
      </div>
    );
  }
  return (
    <div className="result-bad">
      <strong>✗ 검증 실패 ({result.errors.length}) — SSOT 불변</strong>
      <ErrorList errors={result.errors} />
    </div>
  );
}

function ErrorList({ errors }: { errors: { path: string; msg: string }[] }) {
  return (
    <ul className="error-list">
      {errors.map((e, i) => (
        <li key={i}>
          <code>{e.path}</code> {e.msg}
        </li>
      ))}
    </ul>
  );
}
