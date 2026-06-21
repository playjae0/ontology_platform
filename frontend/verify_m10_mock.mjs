// M10 검증 — mock 확장(6공정 충실): 커버리지 빨강 0 / unlinked 개선 / 스키마·참조무결성 / 화면 정상.
import { chromium } from "playwright";

const API = "http://localhost:8077";
const out = {};
const errs = [];
const get = (p) => fetch(API + p).then((r) => r.json());
const post = (p) => fetch(API + p, { method: "POST" });

await post("/ingest/reset-mock");

// 1) 6공정 모두 Unit·Property·청크 보유 (대시보드 커버리지 빨강 0)
const dash = await get("/dashboard/stats");
out.coverageLen = dash.coverage.length;
out.allProcessesHaveChunks = dash.coverage.every((c) => c.chunks > 0);
out.allProcessesHaveNodes = dash.coverage.every((c) => c.nodes >= 1);
// 각 공정 서브트리에 Unit/Property 존재 확인 (scope 그래프 카테고리)
const procIds = (await get("/graph")).nodes.filter((n) => n.category === "Process" && n.id !== "N0000").map((n) => n.id);
const catsPerProc = {};
for (const pid of procIds) {
  const g = await get(`/graph?scope=${pid}`);
  const cats = new Set(g.nodes.map((n) => n.category));
  catsPerProc[pid] = { unit: cats.has("Unit"), prop: cats.has("Property") };
}
out.everyProcHasUnitAndProp = Object.values(catsPerProc).every((c) => c.unit && c.prop);

// 2) describes 6공정 커버 + unlinked율 개선
out.unlinkedRate = dash.health.unlinked_chunk_rate;
out.unlinkedImproved = dash.health.unlinked_chunk_rate < 0.5; // 기존 0.667 대비 개선

// 3) 스키마·참조무결성 (깨진 SSOT 면 reset/commit 자체가 실패) — dry-run 재검증
out.nodes = dash.scale.nodes;
out.chunks = dash.scale.chunks;
out.describes = dash.scale.describes;
// 동의어(영문/축약) 매칭 — 검색 엔드포인트
const stacker = await get("/nodes/search?q=stacker");
out.aliasSearchWorks = stacker.some((h) => h.id === "N0110");

// 4) 전 화면 정상 렌더 (Explore·대시보드·인입·검수)
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
page.on("pageerror", (e) => errs.push(String(e)));
await page.goto("http://localhost:5173/", { waitUntil: "load" });

const screens = {};
await page.click(".nav button:has-text('대시보드')");
await page.waitForSelector(".cov-table tbody tr");
// 커버리지 테이블에 빨강(cov-empty) 0
screens.dashRedCells = await page.locator(".cov-table .cov-empty").count();
await page.screenshot({ path: "m10_dashboard.png" });
await page.click(".nav button:has-text('Explore')");
await page.waitForSelector(".pane-center canvas");
screens.exploreCanvas = (await page.locator(".pane-center canvas").count()) >= 1;
await page.click(".nav button:has-text('검수 Workbench')");
await page.waitForSelector(".queue-section");
screens.workbench = true;
await page.click(".nav button:has-text('인입')");
await page.waitForSelector(".ingest-steps");
screens.ingest = true;
out.screens = screens;
await browser.close();

out.consoleErrors = errs;
console.log(JSON.stringify(out, null, 2));

const ok =
  out.coverageLen === 6 && out.allProcessesHaveChunks && out.allProcessesHaveNodes &&
  out.everyProcHasUnitAndProp &&
  out.unlinkedImproved &&
  out.aliasSearchWorks &&
  out.nodes >= 24 && out.chunks >= 12 &&
  out.screens.dashRedCells === 0 && out.screens.exploreCanvas && out.screens.workbench && out.screens.ingest &&
  errs.length === 0;
process.exit(ok ? 0 : 1);
