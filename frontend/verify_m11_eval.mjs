// M11 검증 — 검색(retrieval) + Eval: 알려진 질문 gold 반환 / Recall@k·MRR·패턴분해 / gap / §6.6·§6.2 / UI.
import { chromium } from "playwright";

const API = "http://localhost:8077";
const out = {};
const errs = [];
const get = (p) => fetch(API + p).then((r) => r.json());
const post = (p) => fetch(API + p, { method: "POST" }).then((r) => r.json());
const q = (s) => encodeURIComponent(s);

await fetch(API + "/ingest/reset-mock", { method: "POST" });

// 1) 알려진 질문 → gold 노드·청크 (별칭+탐색만)
const r1 = await get(`/retrieve?q=${q("stack alignment 관리값")}&k=5`);
out.linkedNames = r1.linked_nodes.map((n) => n.name);
out.chunkCids = r1.chunks.map((c) => c.cid);
out.knownResolved = r1.linked_nodes.some((n) => n.id === "N0210") && out.chunkCids.includes("C0010") && !r1.gap;

// 별칭 매칭(영문) 동작
const r2 = await get(`/retrieve?q=${q("laser welder 로 탭 접합")}&k=5`);
out.aliasLinkWorks = r2.linked_nodes.some((n) => n.id === "N0111") && r2.chunks.some((c) => c.cid === "C0012");

// 3) 미해소 → gap (임베딩 fallback 없음)
const r3 = await get(`/retrieve?q=${q("ESD 접지 저항 규격은?")}`);
out.gapDetected = r3.gap === true && r3.chunks.length === 0;

// 4) §6.6 — 질문 표현이 alias 에 누적되지 않음
const before = (await get("/nodes/N0110")).aliases;
await get(`/retrieve?q=${q("stacker XYZ 임시표현 12345")}&k=5`);
const after = (await get("/nodes/N0110")).aliases;
out.aliasNotAccumulated = JSON.stringify(before) === JSON.stringify(after) && !after.includes("stacker XYZ 임시표현 12345");

// 2) 골든셋 실행 → Recall@k / MRR / 패턴 분해
const ev = await post("/eval/run?k=5");
out.recallAtK = ev.summary.recall_at_k;
out.mrr = ev.summary.mrr;
out.byPattern = ev.summary.by_pattern;
out.patternCount = Object.keys(ev.summary.by_pattern).length;
out.gapsIds = ev.summary.gaps.map((g) => g.id);
out.evalN = ev.summary.n;

// 5) UI: Test/Eval 탭 렌더 + 평가 실행 + 지표/표
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
page.on("pageerror", (e) => errs.push(String(e)));
await page.goto("http://localhost:5173/", { waitUntil: "load" });
await page.click(".nav button:has-text('Test/Eval')");
await page.waitForSelector(".eval-band .batch-table tbody tr");
out.goldenRows = await page.locator(".eval-band .batch-table tbody tr").count();
await page.getByRole("button", { name: /평가 실행/ }).click();
await page.waitForSelector(".eval-metrics");
out.uiMetricsShown = (await page.locator(".eval-metrics .counter-box").count()) >= 3;
// 질문하기(검색)
await page.locator(".ask-result, .eval-band:has-text('질문하기')").first().waitFor().catch(() => {});
await page.locator(".eval-band:has-text('질문하기') button").click();
await page.waitForSelector(".ask-result .chunk-card");
out.askWorks = (await page.locator(".ask-result .chunk-card").count()) >= 1;
await page.screenshot({ path: "m11_eval.png", fullPage: true });
await browser.close();

out.consoleErrors = errs;
console.log(JSON.stringify(out, null, 2));

const ok =
  out.knownResolved && out.aliasLinkWorks &&
  out.gapDetected &&
  out.aliasNotAccumulated &&
  out.recallAtK >= 0.7 && out.mrr >= 0.7 && out.patternCount >= 4 &&
  out.gapsIds.includes("G21") && out.evalN >= 15 &&
  out.goldenRows >= 15 && out.uiMetricsShown && out.askWorks &&
  errs.length === 0;
process.exit(ok ? 0 : 1);
