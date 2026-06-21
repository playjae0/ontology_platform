// M6 검증 — 대시보드: 집계 정확 / 탭 렌더·카드·차트 / 공정 커버리지 6공정.
import { chromium } from "playwright";

const API = "http://localhost:8077";
const out = {};
const errs = [];
const get = (p) => fetch(API + p).then((r) => r.json());
const post = (p) => fetch(API + p, { method: "POST" });

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

const ok =
  out.nodes === 11 &&
  out.byCat.Process === 7 && out.byCat.Unit === 2 && out.byCat.Property === 2 &&
  out.edges === 15 && out.byRel.part_of === 8 && out.byRel.precedes === 5 && out.byRel.has_property === 2 &&
  out.status.confirmed === 9 && out.status.proposed === 2 &&
  out.aliasesTotal === 10 &&
  out.unlinkedRate === 0.667 && out.orphanRate === 0.0 &&
  out.queueTotal === 4 &&
  out.coverageLen === 6 &&
  out.cov0.name === "노칭" && out.cov0.nodes === 5 && out.cov0.chunks === 2 &&
  out.cardCount >= 6 && out.covRows === 6 && out.barCount >= 3 &&
  errs.length === 0;
process.exit(ok ? 0 : 1);
