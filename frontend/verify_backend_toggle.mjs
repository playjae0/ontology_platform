// 백엔드 토글(JSON⇄Neo4j) 진단 검증 — 동일 렌더 / 응답시간 표시 / 미가동 fallback / 시간차.
import { chromium } from "playwright";
import { readFileSync } from "fs";
import { execSync } from "child_process";

const API = "http://localhost:8077";
const out = { observations: [] };
const errs = [];
const get = (p) => fetch(API + p).then((r) => r.json());
const postRaw = (p, b) => fetch(API + p, { method: "POST", headers: b ? { "Content-Type": "application/json" } : undefined, body: b });
const sh = (c) => { try { execSync(c, { stdio: "pipe" }); return true; } catch { return false; } };

// 0) 1027-fixture 적재 + neo4j sync (시간차 가시화용)
await postRaw("/ingest/reset-mock");
await postRaw("/ingest/upload/skeleton?adopt=true", readFileSync("../data/mock/scale/assembly_skeleton.json", "utf-8"));
await postRaw("/ingest/upload/contents?adopt=true", readFileSync("../data/mock/scale/contents.json", "utf-8"));
await postRaw("/neo4j/sync");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
page.on("pageerror", (e) => errs.push(String(e)));

// ---- Part A: neo4j 가동 — 토글 동작 ----
await page.goto("http://localhost:5173/", { waitUntil: "load" });
await page.waitForSelector(".backend-toggle");
await page.locator(".scope-btn", { hasText: "노칭" }).first().click(); // 공정 스코프
await page.waitForSelector(".pane-center canvas");
await page.waitForTimeout(800);
// 기본 JSON 응답시간 표시
out.jsonMsText = (await page.textContent(".bt-ms")).trim();
const jsonNodes = (await get("/graph?scope=N0001")).nodes.length;

// Neo4j 전환
await page.locator(".bt-seg button", { hasText: "Neo4j" }).click();
await page.waitForTimeout(1200);
out.neo4jMsText = (await page.textContent(".bt-ms")).trim();
const neo4jNodes = (await get("/graph?scope=N0001&backend=neo4j")).nodes.length;
out.sameData = jsonNodes === neo4jNodes && jsonNodes > 100;
out.jsonShown = /JSON · \d+ms/.test(out.jsonMsText);
out.neo4jShown = /Neo4j · \d+ms/.test(out.neo4jMsText);

// gate4: 전체 보기로 1027 시간차 가시화 (JSON then Neo4j)
await page.locator(".bt-seg button", { hasText: "JSON" }).click();
await page.locator(".scope-btn", { hasText: "전체 보기" }).click();
await page.waitForTimeout(1500);
out.fullJsonMs = +(/JSON · (\d+)ms/.exec(await page.textContent(".bt-ms"))?.[1] ?? -1);
await page.locator(".bt-seg button", { hasText: "Neo4j" }).click();
await page.waitForTimeout(2000);
out.fullNeo4jMs = +(/Neo4j · (\d+)ms/.exec(await page.textContent(".bt-ms"))?.[1] ?? -1);
out.observations.push(`1027노드 full-graph 토글: JSON ${out.fullJsonMs}ms vs Neo4j ${out.fullNeo4jMs}ms (가시화)`);
await page.screenshot({ path: "m7_backend_toggle.png" });

// ---- Part B: neo4j 미가동 — 토글 비활성 + json 동작 (gate3) ----
sh("docker stop onto-neo4j");
await postRaw("/neo4j/deactivate");
await page.reload({ waitUntil: "load" });
await page.waitForSelector(".backend-toggle");
await page.locator(".scope-btn", { hasText: "노칭" }).first().click();
await page.waitForSelector(".pane-center canvas");
// Neo4j 클릭 → sync 실패 → 미가동 표시 + json 유지
await page.locator(".bt-seg button", { hasText: "Neo4j" }).click();
await page.waitForTimeout(2500);
const neoBtnText = await page.locator(".bt-seg button").nth(1).textContent();
out.neo4jDisabledOnDown = /미가동/.test(neoBtnText) && await page.locator(".bt-seg button").nth(1).isDisabled();
out.jsonStillRenders = (await page.locator(".pane-center canvas").count()) >= 1;
// backend 직접 확인: neo4j 503, json 200
out.downNeo4j503 = (await postRaw("/graph?backend=neo4j").catch(() => ({ status: 0 }))).status;
const gj = await (await fetch(`${API}/graph?backend=neo4j`)).status;
out.downNeo4jStatus = gj;
out.downJsonStatus = (await fetch(`${API}/graph`)).status;

await browser.close();

// 복구: neo4j 재가동 + 준비대기 + 재동기, mock 리셋
sh("docker start onto-neo4j");
let ready = false;
for (let i = 0; i < 40; i++) {
  const r = await postRaw("/neo4j/sync");
  if (r.status === 200) { ready = true; break; }
  await new Promise((res) => setTimeout(res, 2000));
}
out.neo4jRecovered = ready;
await postRaw("/ingest/reset-mock");
await postRaw("/neo4j/deactivate");

// gate3 다운테스트 중 의도된 503 네트워크 실패는 정상 — 실제 JS 에러만 집계
const realErrs = errs.filter((e) => !/Failed to load resource|503/.test(e));
out.consoleErrors = realErrs;
out.expected503 = errs.length - realErrs.length;
console.log(JSON.stringify(out, null, 2));

const ok =
  out.sameData && out.jsonShown && out.neo4jShown &&
  out.fullJsonMs > 0 && out.fullNeo4jMs > 0 &&
  out.neo4jDisabledOnDown === true && out.jsonStillRenders === true &&
  out.downNeo4jStatus === 503 && out.downJsonStatus === 200 &&
  out.neo4jRecovered === true &&
  realErrs.length === 0;
process.exit(ok ? 0 : 1);
