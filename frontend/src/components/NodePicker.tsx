// 검색형 노드 선택 콤보박스 (typeahead) — §M5 노드 선택 개선.
// 검색 키: canonical_name + aliases + id. 후보 표시 "이름 (category · id)".
// 직접 입력: id/이름 타이핑 → 매치에서 선택. 매치 없으면 미설정(거부).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { searchNodes } from "../api";
import type { GraphNode } from "../api";

interface Props {
  value: string; // 선택된 노드 id ("" = 미설정)
  onChange: (id: string) => void;
  nodes: GraphNode[]; // 현재 값 라벨 표시용(이름/category)
  exclude?: string; // 후보에서 제외할 id(자기 자신 등)
  placeholder?: string;
}

export default function NodePicker({
  value,
  onChange,
  nodes,
  exclude,
  placeholder = "노드 검색 (이름·별칭·id)",
}: Props) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);

  const search = useQuery({
    queryKey: ["nodeSearch", q],
    queryFn: () => searchNodes(q, 20),
    enabled: open && q.trim().length > 0,
    staleTime: 5_000,
  });
  const results = (search.data ?? []).filter((n) => n.id !== exclude);

  const selected = nodes.find((n) => n.id === value);
  const label = selected
    ? `${selected.caption} (${selected.category} · ${selected.id})`
    : value || "";

  function pick(id: string) {
    onChange(id);
    setQ("");
    setOpen(false);
  }

  return (
    <div className="nodepicker">
      <input
        className="np-input"
        value={open ? q : label}
        placeholder={placeholder}
        onFocus={() => {
          setOpen(true);
          setQ("");
        }}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && results.length > 0) {
            e.preventDefault();
            pick(results[0].id);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && q.trim().length > 0 && (
        <ul className="np-list">
          {results.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                className="np-opt"
                // onMouseDown(blur 전 발화)으로 선택 확정
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(n.id);
                }}
              >
                {n.canonical_name}{" "}
                <span className="muted">({n.category} · {n.id})</span>
                {n.aliases.length > 0 && (
                  <span className="np-alias"> · {n.aliases.join(", ")}</span>
                )}
              </button>
            </li>
          ))}
          {!search.isLoading && results.length === 0 && (
            <li className="np-empty">매치 없음 — 없는 id/이름</li>
          )}
        </ul>
      )}
    </div>
  );
}
