// M9 검증 — 인입 워크스페이스: 다문서 배치 ①~⑤ 단계 흐름 + 게이트 + per-doc describes/orphan.
import { chromium } from "playwright";

const API = "http://localhost:8077";
const out = {};
const errs = [];
const get = (p) => fetch(API + p).then((r) => r.json());
const post = (p, b) => fetch(API + p, { method: "POST", headers: b ? { "Content-Type": "application/json" } : undefined, body: b ? JSON.stringify(b) : undefined });
const nodes = async () => (await get("/data/status")).counts.nodes;
const step = (page, n) => page.locator(`.ingest-step[data-step="${n}"] button`);

await post("/ingest/reset-mock");
await post("/ingest/batch/reset");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1300, height: 950 } });
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
page.on("pageerror", (e) => errs.push(String(e)));
await page.goto("http://localhost:5173/", { waitUntil: "load" });
await page.click(".nav button:has-text('인입')");
await page.waitForSelector(".ingest-steps");

// ① 업로드 (2문서, 기본 입력값)
await page.locator(".ingest-band", { hasText: "문서 업로드" }).getByRole("button", { name: "업로드" }).click();
await page.waitForSelector(".batch-table tbody tr");
out.uploadedRows = await page.locator(".batch-table tbody tr").count();

// 게이트: ②없이 ③ 비활성
out.skeletonDisabledBeforeParse = await step(page, "③").isDisabled();

// ② 파싱 → 행마다 청크수 (gate1)
await step(page, "②").click();
await page.waitForTimeout(900);
const b1 = await get("/ingest/batch");
out.perDocChunks = b1.docs.map((d) => d.chunks);
out.allParsed = b1.docs.every((d) => d.parse === "done" && d.chunks === 2);

// ③ 뼈대 → 전 문서 후보가 하나의 리뷰 큐에 (gate2)
out.nodesBeforeApprove = await nodes();
await step(page, "③").click();
await page.waitForTimeout(900);
const q1 = await get("/review/queue");
const batchItems = q1.items.filter((i) => i.from_batch);
out.batchCandidates = batchItems.length;
out.sharedQueue = out.batchCandidates === 2;
out.uploadNotApprove = (await nodes()) === out.nodesBeforeApprove; // ③은 후보까지(업로드≠승인)

// 게이트: ③승인 전 ⑤ 차단 (gate3a)
out.contentDisabledBeforeApprove = await step(page, "⑤").isDisabled();

// ④ Workbench 핸드오프 버튼 동작
await step(page, "④").click();
out.handoffToWorkbench = await page.locator(".nav button.active", { hasText: "검수 Workbench" }).count() > 0;
await page.click(".nav button:has-text('인입')");

// ④ 승인 (M3 재사용, API) → 노드 +2
await post("/review/approve-batch", { rids: batchItems.map((i) => i.rid) });
out.nodesAfterApprove = await nodes();
out.approveMaterializes = out.nodesAfterApprove === out.nodesBeforeApprove + 2;

// 새 상태 반영 위해 reload
await page.reload({ waitUntil: "load" });
await page.click(".nav button:has-text('인입')");
await page.waitForSelector(".batch-table tbody tr"); // 배치 데이터 로드 완료까지 대기
// ④ 단계가 검수완료(큐 0)로 반영될 때까지 대기 후 ⑤ 게이트 확인
await page.waitForFunction(
  () => !document.querySelector('.ingest-step[data-step="⑤"] button')?.disabled,
  { timeout: 8000 },
).catch(() => {});

// 게이트: 승인 후 ⑤ 가능 (gate3b)
out.contentEnabledAfterApprove = !(await step(page, "⑤").isDisabled());

// ⑤ 콘텐츠 연결 → describes + 미해소 orphan (per-doc, gate4)
await step(page, "⑤").click();
await page.waitForTimeout(900);
const b2 = await get("/ingest/batch");
out.perDocDescribes = b2.docs.map((d) => d.describes);
out.perDocOrphans = b2.docs.map((d) => d.orphans);
out.linkResult = b2.docs.every((d) => d.link === "done" && d.describes === 1 && d.orphans === 1);
await page.screenshot({ path: "m9_ingest.png" });

await browser.close();
await post("/ingest/reset-mock");
await post("/ingest/batch/reset");

out.consoleErrors = errs;
console.log(JSON.stringify(out, null, 2));

const ok =
  out.uploadedRows === 2 &&
  out.skeletonDisabledBeforeParse === true &&
  out.allParsed && JSON.stringify(out.perDocChunks) === "[2,2]" &&
  out.sharedQueue && out.uploadNotApprove &&
  out.contentDisabledBeforeApprove === true &&
  out.handoffToWorkbench === true &&
  out.approveMaterializes &&
  out.contentEnabledAfterApprove === true &&
  out.linkResult &&
  errs.length === 0;
process.exit(ok ? 0 : 1);
