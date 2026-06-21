// M8 검증 — 렌더-at-scale: 확장형 스코핑 / 레이아웃 분기 / WebGL config / 소규모 회귀.
import { chromium } from "playwright";
import { readFileSync } from "fs";

const API = "http://localhost:8077";
const out = {};
const errs = [];
const postRaw = (p, b) => fetch(API + p, { method: "POST", headers: b ? { "Content-Type": "application/json" } : undefined, body: b });

const measureNonblank = (page) => page.evaluate(() => {
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
const sbCount = async (page) => {
  const t = await page.locator(".scale-bar").textContent();
  return +(/(\d+)\/\d+ 노드/.exec(t)?.[1] ?? -1);
};

// 1027-fixture 적재
await postRaw("/ingest/reset-mock");
await postRaw("/ingest/upload/skeleton?adopt=true", readFileSync("../data/mock/scale/assembly_skeleton.json", "utf-8"));
await postRaw("/ingest/upload/contents?adopt=true", readFileSync("../data/mock/scale/contents.json", "utf-8"));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
page.on("pageerror", (e) => errs.push(String(e)));
await page.goto("http://localhost:5173/", { waitUntil: "load" });

// 1) 노칭 스코프(171) → 확장형 ~50 이하 + 클릭(검색) 확장
await page.locator(".scope-btn", { hasText: "노칭" }).first().click();
await page.waitForSelector(".scale-bar");
await page.waitForSelector(".pane-center canvas");
await page.waitForTimeout(800);
out.egoTag = (await page.locator(".scale-tag").textContent())?.trim();
out.initialVisible = await sbCount(page);
out.under50 = out.initialVisible > 0 && out.initialVisible <= 50;
out.egoLayout = await page.locator(".nvl-host").getAttribute("data-layout-mode");
await page.screenshot({ path: "m8_ego.png" });
// 확장: 좌측 검색으로 설비 선택 → 이웃(인자) 펼침
await page.fill(".search-input", "노칭설비02");
await page.waitForSelector(".search-hit");
await page.locator(".search-hit").first().click();
await page.waitForTimeout(800);
out.afterExpand = await sbCount(page);
out.expandWorks = out.afterExpand > out.initialVisible;

// 2) 전체 평면 보기 → force 레이아웃, 안 겹침(spread)
await page.locator(".scale-bar button", { hasText: "전체 평면 보기" }).click();
await page.waitForTimeout(2800);
out.flatLayout = await page.locator(".nvl-host").getAttribute("data-layout-mode");
out.flatNonblank = await measureNonblank(page);
out.flatSpread = out.flatNonblank > 0.5;
await page.screenshot({ path: "m8_flat_force.png" });

// 3) WebGL config 토글
out.rendererBefore = await page.locator(".nvl-host").getAttribute("data-renderer");
await page.locator(".webgl-toggle").click();
await page.waitForTimeout(400);
out.rendererAfter = await page.locator(".nvl-host").getAttribute("data-renderer");
out.webglToggle = out.rendererBefore === "canvas" && out.rendererAfter === "webgl";
await page.locator(".webgl-toggle").click(); // 헤드리스 안전 위해 canvas 복귀
await page.waitForTimeout(300);

// 4) 소규모(11 mock) → 결정적 레이아웃, scale-bar 없음 (회귀)
await postRaw("/ingest/reset-mock");
await page.reload({ waitUntil: "load" });
await page.waitForSelector(".pane-center canvas");
await page.waitForTimeout(900);
out.smallNoScaleBar = (await page.locator(".scale-bar").count()) === 0;
out.smallLayout = await page.locator(".nvl-host").getAttribute("data-layout-mode");
out.smallNonblank = await measureNonblank(page);

await browser.close();
await postRaw("/ingest/reset-mock");

out.consoleErrors = errs.filter((e) => !/Failed to load resource|503/.test(e));
console.log(JSON.stringify(out, null, 2));

const ok =
  /확장형/.test(out.egoTag) && out.under50 && out.egoLayout === "deterministic" && out.expandWorks &&
  out.flatLayout === "force" && out.flatSpread &&
  out.webglToggle &&
  out.smallNoScaleBar && out.smallLayout === "deterministic" && out.smallNonblank > 1 &&
  out.consoleErrors.length === 0;
process.exit(ok ? 0 : 1);
