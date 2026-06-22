// M13 검증 — 문서관리: /documents 집계 / 문서 상세(청크+describes+meta) / 노드 역방향 출처 / 이벤트 문서 / 읽기전용.
import { chromium } from "playwright";

const API = "http://localhost:8077";
const out = {};
const errs = [];
const get = (p) => fetch(API + p).then((r) => r.json());
const post = (p) => fetch(API + p, { method: "POST" });

await post("/ingest/reset-mock");

// 1) /documents 전체 + 집계
const docs = await get("/documents");
out.docCount = docs.length;
const byId = Object.fromEntries(docs.map((d) => [d.doc_id, d]));
out.mockDoc = byId["MOCK"]; // 구조 문서: 노칭 닿음
out.issueDoc = byId["ISSUE_NOTCH"]; // 이벤트 문서
out.aggregatesOk = out.mockDoc?.layer === "structure" && out.mockDoc?.processes.includes("노칭") && out.mockDoc?.node_count === 4
  && out.issueDoc?.layer === "event" && out.issueDoc?.processes.includes("노칭");

// 2) 문서 상세 → 청크 + describes 노드 + meta
const det = await get("/documents/ISSUE_NOTCH");
out.detailChunks = det.chunks.length;
out.detailHasDescribes = det.chunks.every((c) => c.cid !== "C0020" || c.describes.some((t) => t.id === "N0401"));
out.detailHasMeta = det.chunks.some((c) => c.meta && c.meta.lot === "LOT-2603");
out.footprint = det.footprint.map((f) => `${f.name}:${f.category}`);

// 4) 이벤트 문서: FailureMode describe + 발생 meta
out.eventFM = det.footprint.some((f) => f.category === "FailureMode" && f.name === "버발생");

// 3) 노드 역방향 출처 (전 층): 이벤트 노드 + 구조 노드
const provFM = await get("/nodes/N0401/provenance");
out.provFMdocs = [...new Set(provFM.describes_chunks.map((c) => c.doc_id))];
out.provFMmeta = provFM.describes_chunks.some((c) => c.meta && c.meta.line === "L2");
const provStruct = await get("/nodes/N0101/provenance");
out.provStructDocs = [...new Set(provStruct.describes_chunks.map((c) => c.doc_id))];
out.reverseOk = out.provFMdocs.includes("ISSUE_NOTCH") && out.provStructDocs.includes("MOCK");

// 5) 읽기 전용 + 스키마 무변경 (노드 수 불변) + 임베딩(별도 bash). 쓰기 엔드포인트 부재
out.nodesUnchanged = (await get("/data/status")).counts.nodes === 30;
out.noWriteEndpoint = (await post("/documents")).status; // POST /documents → 405

// UI: 문서관리 탭 → 카탈로그 → 상세 → 역방향 → Explore 점프
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
page.on("pageerror", (e) => errs.push(String(e)));
await page.goto("http://localhost:5173/", { waitUntil: "load" });
await page.click(".nav button:has-text('문서관리')");
await page.waitForSelector(".doc-card");
out.uiCatalogCards = await page.locator(".doc-card").count();
// 이벤트 문서 상세
await page.locator(".doc-card", { hasText: "ISSUE_NOTCH" }).first().click();
await page.waitForSelector(".doc-view .chunk-card");
out.uiDocChunks = await page.locator(".doc-view .chunk-card").count();
out.uiMetaPill = (await page.locator(".meta-pill").count()) >= 1;
out.uiFootprint = (await page.locator(".footprint .fp-node").count()) >= 1;
// 발자국 노드 클릭 → 역방향 출처
await page.locator(".footprint .fp-node").first().click();
await page.waitForSelector(".doc-view h4");
out.uiProvenance = (await page.locator(".doc-view .chunk-card").count()) >= 1;
await page.screenshot({ path: "m13_docs.png" });
// Explore 점프
await page.locator(".doc-view .jump").first().click();
await page.waitForTimeout(500);
out.uiJumped = (await page.locator(".nav button.active", { hasText: "Explore" }).count()) === 1
  && (await page.locator(".node-detail").count()) >= 1;
await browser.close();

out.consoleErrors = errs;
console.log(JSON.stringify(out, null, 2));

const ok =
  out.docCount >= 8 && out.aggregatesOk &&
  out.detailChunks === 2 && out.detailHasDescribes && out.detailHasMeta &&
  out.eventFM &&
  out.reverseOk && out.provFMmeta &&
  out.nodesUnchanged && out.noWriteEndpoint === 405 &&
  out.uiCatalogCards >= 8 && out.uiDocChunks >= 2 && out.uiMetaPill && out.uiFootprint && out.uiProvenance && out.uiJumped &&
  errs.length === 0;
process.exit(ok ? 0 : 1);
