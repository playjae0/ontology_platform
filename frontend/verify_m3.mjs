// M3 검증 — 검수 Workbench: 큐 렌더 → 승인(그래프 반영) / 별칭 흡수 / 일괄 승인.
import { chromium } from "playwright";

const URL = "http://localhost:5173/";
const out = {};
const errs = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
page.on("pageerror", (e) => errs.push(String(e)));

const queueCount = () => page.locator(".queue-list li").count();
const nodeCount = async () =>
  (await page.textContent(".topbar-counts"))?.match(/노드 (\d+)/)?.[1];

await page.goto(URL, { waitUntil: "load" });
await page.click(".nav button:has-text('검수 Workbench')");
await page.waitForSelector(".queue-list li", { timeout: 8000 });

out.initialQueue = await queueCount();
out.initialNodes = await nodeCount();

// 1) R001(레이저노칭기) 승인 → 큐 4→3, 노드 11→12
await page.locator(".queue-item", { hasText: "레이저노칭기" }).click();
await page.waitForSelector(".editor h3");
out.editorShows = (await page.textContent(".editor-head h3"))?.trim();
out.evidenceShown = await page.locator(".editor .chunk-text").first().textContent();
await page.getByRole("button", { name: "승인", exact: true }).click();
await page.waitForFunction(() => document.querySelectorAll(".queue-list li").length === 3, { timeout: 8000 });
out.afterApproveQueue = await queueCount();
out.afterApproveNodes = await nodeCount();

// 2) R004(NP-2) → N0101 별칭 흡수 → 큐 3→2 (노드 수 불변)
await page.locator(".queue-item", { hasText: "NP-2" }).click();
await page.locator(".editor select").nth(1).selectOption("N0101");
await page.getByRole("button", { name: "별칭으로 흡수" }).click();
await page.waitForFunction(() => document.querySelectorAll(".queue-list li").length === 2, { timeout: 8000 });
out.afterAbsorbQueue = await queueCount();
out.afterAbsorbNodes = await nodeCount();

await page.screenshot({ path: "m3_workbench.png" });

// 3) 일괄 승인: R002(노칭속도) 체크 → 일괄 승인 → 큐 2→1(R003 orphan 잔류), 노드 +1
await page.locator(".queue-list li", { hasText: "노칭속도" }).locator("input[type=checkbox]").check();
await page.getByRole("button", { name: /일괄 승인/ }).click();
await page.waitForFunction(() => document.querySelectorAll(".queue-list li").length === 1, { timeout: 8000 });
out.afterBatchQueue = await queueCount();
out.afterBatchNodes = await nodeCount();
out.remainingKind = (await page.locator(".queue-item .kind-badge").first().textContent())?.trim();

await browser.close();
out.consoleErrors = errs;
console.log(JSON.stringify(out, null, 2));

const ok =
  out.initialQueue === 4 && out.initialNodes === "11" &&
  out.editorShows === "레이저노칭기" &&
  out.afterApproveQueue === 3 && out.afterApproveNodes === "12" &&
  out.afterAbsorbQueue === 2 && out.afterAbsorbNodes === "12" &&
  out.afterBatchQueue === 1 && out.afterBatchNodes === "13" &&
  out.remainingKind === "orphan_unit" &&
  errs.length === 0;
process.exit(ok ? 0 : 1);
