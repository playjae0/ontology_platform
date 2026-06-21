// M12 검증 — 이벤트 층: 스키마/방향경고 / 이벤트 렌더·카운트 / Mode C materialize / 추적질의 / 층분리.
import { chromium } from "playwright";

const API = "http://localhost:8077";
const out = {};
const errs = [];
const get = (p) => fetch(API + p).then((r) => r.json());
const postRaw = (p, b) => fetch(API + p, { method: "POST", headers: b ? { "Content-Type": "application/json" } : undefined, body: b ? JSON.stringify(b) : undefined });
const post = (p, b) => postRaw(p, b).then((r) => r.json());
const structCount = async () => { const c = (await get("/dashboard/stats")).scale.nodes_by_category; return (c.Process || 0) + (c.Unit || 0) + (c.Property || 0); };

await postRaw("/ingest/reset-mock");
await postRaw("/ingest/batch/reset");

// 1) 스키마: FailureMode/Cause·causes/affects 수용 + 방향 경고(막지 않음) + 참조무결성
const dash = await get("/dashboard/stats");
out.evByCat = { FailureMode: dash.scale.nodes_by_category.FailureMode, Cause: dash.scale.nodes_by_category.Cause };
out.evByRel = { causes: dash.scale.edges_by_relation.causes, affects: dash.scale.edges_by_relation.affects };
out.schemaAccepted = out.evByCat.FailureMode === 2 && out.evByCat.Cause === 2 && out.evByRel.causes === 2 && out.evByRel.affects === 4;
// 방향 경고: Property→Property 에 causes (비정상) → ok+warning (막지 않음)
const w = await post("/edges/edit", { op: "add", source: "N0201", relation: "causes", target: "N0202" });
out.directionWarning = w.ok === true && !!w.warning;
await postRaw("/ingest/reset-mock"); // 경고 테스트 엣지 원복
// 참조무결성: causes 가 없는 노드 가리킴 → 채택 거부
const skel = await (await fetch(API + "/graph")).json(); // not skeleton shape; build via mock isn't needed — use upload of bad
const badSkel = { nodes: { N0001: { id: "N0001", canonical_name: "노칭", category: "Process", status: "confirmed", aliases: [] }, N0401: { id: "N0401", canonical_name: "버발생", category: "FailureMode", status: "confirmed", aliases: [] } }, edges: [{ source: "N0401", relation: "affects", target: "N9999", status: "confirmed" }] };
const ref = await post("/ingest/upload/skeleton?adopt=true", badSkel);
out.refIntegrity = ref.valid === false;
await postRaw("/ingest/reset-mock");

// 4) 추적 질의: "버발생" → causes(금형마모)+affects(절단정밀도/노칭프레스)+이슈청크
const r = await get(`/retrieve?q=${encodeURIComponent("버발생 원인과 영향은?")}`);
out.traceLinked = r.linked_nodes.map((n) => n.name);
out.traceTraversed = r.traversed;
out.traceChunks = r.chunks.map((c) => c.cid);
out.tracebackWorks = r.linked_nodes.some((n) => n.id === "N0401")
  && r.traversed.includes("N0501") && r.traversed.includes("N0201") && r.traversed.includes("N0101")
  && out.traceChunks.includes("C0020") && out.traceChunks.includes("C0021");
// 역방향: 구조 노드 → 관련 FailureMode 도달
const rb = await get(`/retrieve?q=${encodeURIComponent("절단정밀도 관련 불량 이력")}`);
out.reverseReach = rb.traversed.includes("N0401");

// 3) + 5) Mode C: 이슈 doc → 후보 → 승인 materialize + 엣지 + describes / 층분리
out.structBefore = await structCount();
await post("/ingest/batch/upload", { names: ["용접_이슈.pdf"] });
await postRaw("/ingest/batch/run/parse");
const ev = await post("/ingest/batch/run/event");
out.eventCandidates = ev.candidates;
const queue = await get("/review/queue");
const fmRid = queue.items.find((i) => i.kind === "new_failuremode")?.rid;
const caRid = queue.items.find((i) => i.kind === "new_cause")?.rid;
out.candidateKinds = queue.items.filter((i) => i.from_batch).map((i) => i.kind);
await post("/review/approve-batch", { rids: [fmRid, caRid] }); // FM 먼저
const fm = (await get(`/nodes/search?q=${encodeURIComponent("용접결함1")}`))[0];
out.fmMaterialized = fm?.category === "FailureMode";
const fmNode = await get(`/nodes/${fm.id}`);
const rels = fmNode.adjacency.map((a) => `${a.relation}:${a.dir}`);
out.fmEdges = { affects: rels.filter((x) => x === "affects:out").length, causesIn: rels.includes("causes:in") };
out.fmHasEdges = out.fmEdges.affects === 2 && out.fmEdges.causesIn;
const fmChunks = await get(`/nodes/${fm.id}/chunks`);
out.fmDescribes = fmChunks.length >= 1;
out.structAfter = await structCount();
out.layerSeparation = out.structAfter === out.structBefore; // 구조 미수정

// 2) UI: 이벤트 노드 렌더(Explore) + 대시보드 이벤트 카운트
await postRaw("/ingest/reset-mock");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
page.on("pageerror", (e) => errs.push(String(e)));
await page.goto("http://localhost:5173/", { waitUntil: "load" });
// 대시보드: 규모 카드 카테고리 막대에 FailureMode/Cause
await page.click(".nav button:has-text('대시보드')");
await page.waitForSelector(".dash-bars");
const catLabels = await page.locator(".dash-bar-label").allTextContents();
out.dashHasEvent = catLabels.some((l) => l.includes("FailureMode")) && catLabels.some((l) => l.includes("Cause"));
// Explore: 이벤트 노드 렌더(필터에 FailureMode/Cause)
await page.click(".nav button:has-text('Explore')");
await page.waitForSelector(".pane-center canvas");
const filterCats = await page.locator(".left-panel .filter-row").allTextContents();
out.exploreHasEventFilter = filterCats.some((l) => l.includes("FailureMode")) && filterCats.some((l) => l.includes("Cause"));
await page.screenshot({ path: "m12_event.png" });
await browser.close();

await postRaw("/ingest/reset-mock");
await postRaw("/ingest/batch/reset");

out.consoleErrors = errs;
console.log(JSON.stringify(out, null, 2));

const ok =
  out.schemaAccepted && out.directionWarning && out.refIntegrity &&
  out.tracebackWorks && out.reverseReach &&
  out.eventCandidates === 2 && out.candidateKinds.includes("new_failuremode") && out.candidateKinds.includes("new_cause") &&
  out.fmMaterialized && out.fmHasEdges && out.fmDescribes &&
  out.layerSeparation &&
  out.dashHasEvent && out.exploreHasEventFilter &&
  errs.length === 0;
process.exit(ok ? 0 : 1);
