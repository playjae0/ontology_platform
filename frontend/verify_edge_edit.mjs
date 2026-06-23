// M5 검증 — 관계(엣지) 편집: 재지정·롤백·삭제→고아·재연결·중복·id불변·merge부재.
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

// ---- API 레벨 게이트 ----
// 2) 없는 노드로 재지정 → 422 + SSOT 불변
out.nonexistentStatus = (await apiPost("/edges/edit",
  { op: "update", source: "N0101", relation: "part_of", target: "N0001", new_target: "N9999" })).status;
out.ssotUnchanged = (await node("N0101")).attached_to;
// 4) 중복 추가 방지 (N0101 part_of N0001 은 이미 존재)
out.dupStatus = (await apiPost("/edges/edit",
  { op: "add", source: "N0101", relation: "part_of", target: "N0001" })).status;
// 5) 노드 merge 부재
out.mergeStatus = (await apiPost("/nodes/N0101/merge", {})).status;

// 고아 만들기: N0102 part_of N0001 삭제
await apiPost("/edges/edit", { op: "delete", source: "N0102", relation: "part_of", target: "N0001" });

// ---- UI 게이트 ----
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
page.on("pageerror", (e) => errs.push(String(e)));

await page.goto("http://localhost:5173/", { waitUntil: "load" });
await page.click(".nav button:has-text('검수 Workbench')");
await page.waitForSelector(".queue-list li");

// 3) 고아 표시
const orphanItem = page.locator(".orphan-item", { hasText: "비전검사기" });
await orphanItem.waitFor({ timeout: 6000 });
out.orphanShown = true;

// 고아 클릭 → NodeEditForm + RelationEditor
await orphanItem.click();
await page.waitForSelector(".rel-add");
await page.screenshot({ path: "m5_relation_editor.png" });

// 재연결: 관계 추가 part_of → N0001 (NodePicker 콤보박스)
await page.locator(".rel-add .rel-type").selectOption("part_of");
await page.locator(".rel-add .np-input").fill("N0001");
await page.waitForSelector(".rel-add .np-opt", { timeout: 5000 });
await page.locator(".rel-add .np-input").press("Enter");
await page.locator(".rel-add-btn").click();
out.reattached = await waitAttached("N0102", "N0001");
await page.waitForFunction(
  () => document.querySelectorAll(".orphan-item").length === 0, { timeout: 6000 });
out.orphanGoneAfterReadd = (await page.locator(".orphan-item").count()) === 0;

// 1) 재지정: part_of 부모 N0001 → N0002 (부모 콤보박스)
const parentPick = page.locator(".rel-group", { hasText: "부모" }).locator(".np-input");
await parentPick.fill("N0002");
await page.locator(".rel-group", { hasText: "부모" }).locator(".np-opt").first().waitFor();
await parentPick.press("Enter");
out.retargeted = await waitAttached("N0102", "N0002");

await browser.close();
out.consoleErrors = errs;
console.log(JSON.stringify(out, null, 2));

const ok =
  out.nonexistentStatus === 422 &&
  out.ssotUnchanged === "N0001" &&
  out.dupStatus === 422 &&
  [404, 405].includes(out.mergeStatus) && // 부재(SPA 정적서빙 시 405, 아니면 404)
  out.orphanShown === true &&
  out.reattached === true &&
  out.orphanGoneAfterReadd === true &&
  out.retargeted === true &&
  errs.length === 0;
process.exit(ok ? 0 : 1);
