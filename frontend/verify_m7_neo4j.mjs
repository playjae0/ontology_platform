// M7 검증 — Neo4j 승격 + 1000-fixture 스케일. JSON=SSOT, Neo4j=재생성 파생 캐시.
// 게이트: ①json==neo4j 동일결과 ②응답시간 측정 ③1000 공정 스코프 렌더 관찰
//        ④JSON 변이→재생성 반영·직접쓰기 부재 ⑤(별도) 8스위트 회귀.
import { chromium } from "playwright";
import { readFileSync } from "fs";

const API = "http://localhost:8077";
const out = { observations: [] };
const errs = [];
const get = (p) => fetch(API + p).then((r) => r.json());
const postRaw = (p, body) =>
  fetch(API + p, { method: "POST", headers: body ? { "Content-Type": "application/json" } : undefined, body });
const post = (p) => postRaw(p).then((r) => r.json());
const timed = async (p) => { const t = performance.now(); await get(p); return +(performance.now() - t).toFixed(1); };

// 0) 1000-fixture 를 SSOT 로 적재
await postRaw("/ingest/reset-mock");
const skel = readFileSync("../data/mock/scale/assembly_skeleton.json", "utf-8");
const cont = readFileSync("../data/mock/scale/contents.json", "utf-8");
const a1 = await (await postRaw("/ingest/upload/skeleton?adopt=true", skel)).json();
const a2 = await (await postRaw("/ingest/upload/contents?adopt=true", cont)).json();
out.fixtureNodes = a1.counts?.nodes;
out.fixtureAdopted = a1.adopted === true && a2.adopted === true;

// 1) JSON → Neo4j 적재 + 동일 결과
const sync = await post("/neo4j/sync");
out.synced = sync.synced;
out.syncMs = sync.sync_ms;
const gj = await get("/graph");
const gn = await get("/graph?backend=neo4j");
const ids = (g) => g.nodes.map((n) => n.id).sort();
const rels = (g) => g.rels.map((r) => `${r.from}|${r.relation}|${r.to}`).sort();
out.nodesEqual = JSON.stringify(ids(gj)) === JSON.stringify(ids(gn)) && gj.nodes.length === out.fixtureNodes;
out.relsEqual = JSON.stringify(rels(gj)) === JSON.stringify(rels(gn));
const dbj = await get("/dashboard/stats");
const dbn = await get("/dashboard/stats?backend=neo4j");
// 키 순서 무관 비교(dict 키 삽입 순서는 백엔드 순회 순서에 따라 다를 수 있음)
const canon = (o) => JSON.stringify(o, Object.keys(JSON.parse(JSON.stringify(o))).length ? replacer : undefined);
function replacer(_k, v) {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return Object.keys(v).sort().reduce((a, k) => { a[k] = v[k]; return a; }, {});
  }
  return v;
}
out.dashboardEqual = canon(dbj.scale) === canon(dbn.scale)
  && canon([...dbj.coverage].sort((a, b) => a.id.localeCompare(b.id)))
   === canon([...dbn.coverage].sort((a, b) => a.id.localeCompare(b.id)));

// 2) 응답시간 (1027노드 full graph) — json vs neo4j
out.tJson = Math.min(await timed("/graph"), await timed("/graph"));
out.tNeo4j = Math.min(await timed("/graph?backend=neo4j"), await timed("/graph?backend=neo4j"));
out.observations.push(`full-graph 읽기 ${out.fixtureNodes}노드: json≈${out.tJson}ms, neo4j≈${out.tNeo4j}ms (full-dump 은 JSON 유리; Neo4j 가치는 그래프 순회/동시성)`);

// 3) 공정 스코프 렌더 관찰 (Explore, 노칭 서브트리)
const scoped = await get("/graph?scope=N0001");
out.scopedNodes = scoped.nodes.length;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
page.on("pageerror", (e) => errs.push(String(e)));
await page.goto("http://localhost:5173/", { waitUntil: "load" });
await page.waitForSelector(".scope-btn");
await page.locator(".scope-btn", { hasText: "노칭" }).first().click();
await page.waitForSelector(".pane-center canvas", { timeout: 10000 });
const tRender0 = performance.now();
await page.waitForTimeout(2500); // 레이아웃/렌더 정착
const renderMs = +(performance.now() - tRender0).toFixed(0);
const drawn = await page.evaluate(() => {
  const cs = document.querySelectorAll(".pane-center canvas");
  let best = 0;
  for (const c of cs) {
    const ctx = c.getContext("2d"); if (!ctx) continue;
    const img = ctx.getImageData(0, 0, c.width, c.height).data;
    let nb = 0, tot = 0;
    for (let i = 0; i < img.length; i += 4 * 11) { tot++; if (img[i + 3] > 5 && !(img[i] > 248 && img[i + 1] > 248 && img[i + 2] > 248)) nb++; }
    best = Math.max(best, +(100 * nb / tot).toFixed(2));
  }
  return best;
});
out.scopeRenderNonblankPct = drawn;
out.scopeRendered = drawn > 0.2;
out.observations.push(`공정 스코프(노칭) ${out.scopedNodes}노드 렌더: nonblank=${drawn}% (canvas 그려짐=${out.scopeRendered}). 노드 밀집 — 대규모(전극/화성) 가면 WebGL+layout+스코핑(M8) 필요 신호.`);
await page.screenshot({ path: "m7_scale_render.png" });
await browser.close();

// 4) JSON 변이 → 재생성 반영 + 직접쓰기 부재
await postRaw("/nodes/N0002/edit", JSON.stringify({ canonical_name: "스태킹-MUT" }));
const nn = await get("/nodes/N0002?backend=neo4j");
out.mutationReflected = nn.canonical_name === "스태킹-MUT";
const w = await postRaw("/neo4j/write", JSON.stringify({}));
out.noDirectWrite = w.status === 404;

// 정리: mock 으로 복원(+neo4j 재동기)
await postRaw("/ingest/reset-mock");

out.consoleErrors = errs;
console.log(JSON.stringify(out, null, 2));

const ok =
  out.fixtureAdopted && out.fixtureNodes >= 1000 &&
  out.synced.nodes === out.fixtureNodes &&
  out.nodesEqual && out.relsEqual && out.dashboardEqual &&
  typeof out.tJson === "number" && typeof out.tNeo4j === "number" &&
  out.scopeRendered &&
  out.mutationReflected && out.noDirectWrite &&
  errs.length === 0;
process.exit(ok ? 0 : 1);
