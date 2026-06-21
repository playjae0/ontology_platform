// M3 정합 검증 — 별칭 흡수 근거 보존: alias 추가 + evidence describes 생성 + 후보 큐 제거,
// 생존노드 chunks 에 근거 노출, describes 무결성(commit ok).
const API = "http://localhost:8077";
const out = {};

const get = (p) => fetch(API + p).then((r) => r.json());
const post = (p, b) =>
  fetch(API + p, { method: "POST", headers: b ? { "Content-Type": "application/json" } : undefined, body: b ? JSON.stringify(b) : undefined });

await post("/ingest/reset-mock");

const before = await get("/nodes/N0101");
out.beforeAliases = before.aliases;
out.beforeDescribes = (await get("/data/status")).counts.describes;

// 흡수: R004(NP-2, evidence C0006) → N0101
const r = await post("/review/absorb", { rid: "R004", target: "N0101" });
const j = await r.json();
out.absorbStatus = r.status;
out.addedAliases = j.added_aliases;
out.linkedDescribes = j.linked_describes;

// 1) aliases 추가 + 큐 제거
const after = await get("/nodes/N0101");
out.afterAliases = after.aliases;
out.aliasAdded = after.aliases.includes("NP-2");
const queue = await get("/review/queue");
out.r004Removed = !queue.items.some((i) => i.rid === "R004");

// 2) 생존노드 chunks 에 근거 청크(C0006) 노출
const chunks = await get("/nodes/N0101/chunks");
out.evidenceExposed = chunks.some((c) => c.cid === "C0006");

// 3) describes 무결성: 증가 + commit ok(=흡수 200)
out.afterDescribes = (await get("/data/status")).counts.describes;

// 정리
await post("/ingest/reset-mock");

console.log(JSON.stringify(out, null, 2));
const ok =
  out.absorbStatus === 200 &&
  out.addedAliases === 1 &&
  out.linkedDescribes === 1 &&
  out.aliasAdded === true &&
  out.r004Removed === true &&
  out.evidenceExposed === true &&
  out.afterDescribes === out.beforeDescribes + 1;
process.exit(ok ? 0 : 1);
