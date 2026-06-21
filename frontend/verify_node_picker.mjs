// M5 노드 피커 검증 — 검색형 콤보박스: 필터+category·id 표시 / id 직접 / 없는것 거부 /
// 부모 현재값 표시(빈칸 버그 해소) / 재지정·추가 콤보박스 경유 + store.commit 회귀 없음.
import { chromium } from "playwright";

const API = "http://localhost:8077";
const out = {};
const errs = [];
const apiPost = (path, body) =>
  fetch(API + path, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
const node = async (id) => (await fetch(`${API}/nodes/${id}`)).json();
const waitAttached = async (id, val, ms = 6000) => {
  const t = Date.now();
  while (Date.now() - t < ms) {
    if ((await node(id)).attached_to === val) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
};

await apiPost("/ingest/reset-mock");
// 고아 만들기: N0102 part_of N0001 삭제 → N0102 고아
await apiPost("/edges/edit", { op: "delete", source: "N0102", relation: "part_of", target: "N0001" });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
page.on("pageerror", (e) => errs.push(String(e)));

await page.goto("http://localhost:5173/", { waitUntil: "load" });
await page.click(".nav button:has-text('검수 Workbench')");
await page.locator(".orphan-item", { hasText: "비전검사기" }).click();
await page.waitForSelector(".rel-add .np-input");

const addPick = page.locator(".rel-add .np-input");

// 1) "노칭" 입력 → 후보 필터 + category·id 표시
await addPick.fill("노칭");
await page.waitForSelector(".rel-add .np-opt", { timeout: 5000 });
const opts = await page.locator(".rel-add .np-opt").allTextContents();
out.searchOpts = opts.map((o) => o.replace(/\s+/g, " ").trim());
out.showsCatId = opts.some((o) => o.includes("Process") && o.includes("N0001"));

// 2) id "N0001" 직접 입력 → 매치
await addPick.fill("N0001");
await page.waitForSelector(".rel-add .np-opt", { timeout: 5000 });
out.idDirectMatch = (await page.locator(".rel-add .np-opt").allTextContents())
  .some((o) => o.includes("N0001"));

// 3) 없는 이름/id → 거부(후보 없음, 추가 버튼 disabled)
await addPick.fill("ZZZZ");
await page.waitForSelector(".rel-add .np-empty", { timeout: 5000 });
out.noMatchEmpty = (await page.locator(".rel-add .np-opt").count()) === 0;
out.addDisabledNoTarget = await page.locator(".rel-add-btn").isDisabled();

// 재연결: part_of → N0001 (Enter 로 첫 후보 선택)
await addPick.fill("N0001");
await page.waitForSelector(".rel-add .np-opt");
await addPick.press("Enter");
out.addEnabledAfterPick = !(await page.locator(".rel-add-btn").isDisabled());
await page.locator(".rel-add-btn").click();
out.reattached = await waitAttached("N0102", "N0001");

// 4) 부모(part_of) 행에 현재 부모 이름+id 표시(빈칸 버그 해소)
const parentPick = page.locator(".rel-group", { hasText: "부모" }).locator(".np-input");
await parentPick.waitFor({ timeout: 5000 });
out.parentLabel = (await parentPick.inputValue()).trim();

await page.screenshot({ path: "m5_node_picker.png" });

// 5) 재지정: 부모 콤보박스로 N0002 선택 → attached_to 동기화
await parentPick.click();
await parentPick.fill("N0002");
await page.locator(".rel-group", { hasText: "부모" }).locator(".np-opt").first().waitFor();
await parentPick.press("Enter");
out.retargeted = await waitAttached("N0102", "N0002");

await browser.close();
out.consoleErrors = errs;
console.log(JSON.stringify(out, null, 2));

const ok =
  out.showsCatId === true &&
  out.searchOpts.length >= 2 &&
  out.idDirectMatch === true &&
  out.noMatchEmpty === true &&
  out.addDisabledNoTarget === true &&
  out.addEnabledAfterPick === true &&
  out.reattached === true &&
  /N0001/.test(out.parentLabel) && /노칭/.test(out.parentLabel) &&
  out.retargeted === true &&
  errs.length === 0;
process.exit(ok ? 0 : 1);
