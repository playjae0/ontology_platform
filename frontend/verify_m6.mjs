// M6 검증 — 대시보드: 집계 정확(mock 파일에서 재계산해 대조) / 탭 렌더·카드 / 6공정 커버리지.
import { chromium } from "playwright";
import { readFileSync } from "fs";

const API = "http://localhost:8077";
const out = {};
const errs = [];
const get = (p) => fetch(API + p).then((r) => r.json());
const post = (p) => fetch(API + p, { method: "POST" });

// mock SSOT 에서 기대 집계 재계산(매 mock 변경에도 견고 — 카운트 상수 하드코딩 금지)
const sk = JSON.parse(readFileSync("../data/mock/assembly_skeleton.json", "utf-8"));
const ct = JSON.parse(readFileSync("../data/mock/contents.json", "utf-8"));
const exp = (() => {
  const nodes = Object.values(sk.nodes);
  const byCat = {}, byRel = {}, byStatus = {};
  let aliases = 0;
  for (const n of nodes) { byCat[n.category] = (byCat[n.category] || 0) + 1; byStatus[n.status] = (byStatus[n.status] || 0) + 1; aliases += (n.aliases || []).length; }
  for (const e of sk.edges) byRel[e.relation] = (byRel[e.relation] || 0) + 1;
  const linked = new Set(ct.describes.map((d) => d.source));
  return { nodes: nodes.length, edges: sk.edges.length, chunks: ct.chunks.length, describes: ct.describes.length,
    byCat, byRel, byStatus, aliases, unlinked: ct.chunks.filter((c) => !linked.has(c.cid)).length };
})();
out.expected = exp;

await post("/ingest/reset-mock");

// 1) 집계 정확
const d = await get("/dashboard/stats");
out.nodes = d.scale.nodes;
out.byCat = d.scale.nodes_by_category;
out.edges = d.scale.edges;
out.byRel = d.scale.edges_by_relation;
out.status = d.status;
out.aliasesTotal = d.dictionary.aliases_total;
out.unlinkedRate = d.health.unlinked_chunk_rate;
out.orphanRate = d.health.orphan_node_rate;
out.queueTotal = d.review.queue_total;
out.queueByKind = d.review.queue_by_kind;

// 3) 공정 커버리지: backbone 6공정 + 노드·청크
out.coverageLen = d.coverage.length;
out.cov0 = d.coverage[0]; // 노칭: nodes 5, chunks 2
out.covNames = d.coverage.map((c) => c.name);
out.coverageAllChunks = d.coverage.every((c) => c.chunks > 0); // 빨강 0 (M10)

// 2) UI: 대시보드 탭 렌더 + 카드/차트
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } });
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
page.on("pageerror", (e) => errs.push(String(e)));
await page.goto("http://localhost:5173/", { waitUntil: "load" });
await page.click(".nav button:has-text('대시보드')");
await page.waitForSelector(".dash-card");
out.cardCount = await page.locator(".dash-card").count();
out.covRows = await page.locator(".cov-table tbody tr").count();
out.barCount = await page.locator(".dash-bar-fill").count();
await page.screenshot({ path: "m6_dashboard.png", fullPage: true });
await browser.close();

await post("/ingest/reset-mock");
out.consoleErrors = errs;
console.log(JSON.stringify(out, null, 2));

// 대시보드 집계 == mock 파일 재계산값 (자체 검증, 카운트 상수 비의존)
const canon = (o) => JSON.stringify(Object.fromEntries(Object.entries(o).sort()));
const eq = (a, b) => canon(a) === canon(b);
const expUnlinkedRate = Math.round((exp.unlinked / exp.chunks) * 1000) / 1000;
const ok =
  out.nodes === exp.nodes && out.edges === exp.edges &&
  eq(out.byCat, exp.byCat) && eq(out.byRel, exp.byRel) &&
  out.status.confirmed === exp.byStatus.confirmed && out.status.proposed === exp.byStatus.proposed &&
  out.aliasesTotal === exp.aliases &&
  out.unlinkedRate === expUnlinkedRate &&
  out.coverageLen === 6 &&
  out.coverageAllChunks === true && // 6공정 모두 청크 보유(커버리지 빨강 0)
  out.cov0.name === "노칭" && out.cov0.nodes >= 5 && out.cov0.chunks >= 2 &&
  out.cardCount >= 6 && out.covRows === 6 && out.barCount >= 3 &&
  errs.length === 0;
process.exit(ok ? 0 : 1);
