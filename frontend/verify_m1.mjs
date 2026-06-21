// M1 검증 스크립트 — NVL 캔버스 렌더 + 노드 클릭→상세/청크 확인 후 스크린샷.
import { chromium } from "playwright";

const URL = "http://localhost:5173/";
const errs = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
page.on("pageerror", (e) => errs.push(String(e)));

await page.goto(URL, { waitUntil: "load" });

// 1) 카운트 헤더가 백엔드에서 채워졌나
await page.waitForSelector(".topbar-counts", { timeout: 10000 });
const counts = await page.textContent(".topbar-counts");

// 2) NVL 캔버스가 렌더됐나
await page.waitForSelector(".pane-center canvas", { timeout: 10000 });
const canvas = await page.$(".pane-center canvas");
const box = await canvas.boundingBox();

// 3) 좌측 검색으로 노칭프레스 선택 → 우측 상세/청크 확인 (클릭 좌표 의존 회피)
await page.fill(".search-input", "노칭프레스");
await page.waitForSelector(".search-hit", { timeout: 5000 });
await page.click(".search-hit");
await page.waitForSelector(".node-detail h2", { timeout: 5000 });
const title = await page.textContent(".node-detail h2");
await page.waitForSelector(".chunk-text", { timeout: 5000 });
const chunk = await page.textContent(".chunk-text");
const adjCount = await page.$$eval(".adj-list li", (els) => els.length);

await page.screenshot({ path: "m1_explore.png", fullPage: false });
await browser.close();

console.log(JSON.stringify({
  counts: counts?.trim(),
  canvas: box ? `${Math.round(box.width)}x${Math.round(box.height)}` : null,
  detailTitle: title?.trim(),
  chunkText: chunk?.trim(),
  adjacency: adjCount,
  consoleErrors: errs,
}, null, 2));

const ok = box && box.width > 100 && title?.includes("노칭프레스") && chunk?.length > 0;
process.exit(ok ? 0 : 1);
