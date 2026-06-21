// M4 검증 — 플러그형 스테이지 슬롯: echo 외부 스크립트 실행→채택 / 깨진 출력→거부·SSOT 불변 /
// manual 슬롯→400 / 스테이지 UI 배지·실행 버튼.
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "fs";

const API = "http://localhost:8077";
const out = {};
const errs = [];

writeFileSync("/tmp/echo_stage.py", "import sys, shutil\nshutil.copyfile(sys.argv[1], sys.argv[2])\n");
writeFileSync("/tmp/broken_stage.py", 'import sys\nopen(sys.argv[2], "w").write("{ not json ")\n');

const get = (p) => fetch(API + p).then((r) => r.json());
const put = (p, b) => fetch(API + p, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
const post = (p, b) => fetch(API + p, { method: "POST", headers: b ? { "Content-Type": "application/json" } : undefined, body: b ? JSON.stringify(b) : undefined });
const run = (slot, b) => post(`/stage/run/${slot}`, b || {});
const nodes = async () => (await get("/data/status")).counts.nodes;

await post("/ingest/reset-mock");
await put("/stage/config", { parser: "manual", skeleton: "manual", content: "manual" });
out.startNodes = await nodes();

// 4) manual 슬롯 실행 → 400
out.manual400 = (await run("skeleton", {})).status;

// 1+2) echo 외부 스테이지: 확장 skeleton 입력 → subprocess → 검증·채택
const sk = JSON.parse(readFileSync("../data/mock/assembly_skeleton.json", "utf-8"));
sk.nodes["N0301"] = { id: "N0301", canonical_name: "외부도입설비", category: "Unit",
  definition: "", aliases: [], attached_to: "N0001", spec: null, status: "proposed",
  provenance: [], embedding: null };
sk.edges.push({ source: "N0301", relation: "part_of", target: "N0001",
  evidence: "stage", status: "proposed", provenance: [] });
await put("/stage/config", { skeleton: "external:python3 /tmp/echo_stage.py" });
const r1 = await run("skeleton", sk);
const j1 = await r1.json();
out.echoStatus = r1.status;
out.echoAdopted = j1.adopted;
out.afterEcho = await nodes();

// 3) 깨진 출력 → 거부(422) + SSOT 불변
await put("/stage/config", { skeleton: "external:python3 /tmp/broken_stage.py" });
const r3 = await run("skeleton", {});
out.brokenStatus = r3.status;
out.afterBroken = await nodes(); // afterEcho 와 같아야(불변)

// UI: external 슬롯 배지 + 실행 버튼
await put("/stage/config", { skeleton: "external:python3 /tmp/echo_stage.py" });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
page.on("pageerror", (e) => errs.push(String(e)));
await page.goto("http://localhost:5173/", { waitUntil: "load" });
await page.click(".nav button:has-text('데이터 관리')");
await page.waitForSelector(".stage-chip");
out.uiExternalBadge = (await page.locator(".badge-ext").count()) >= 1;
out.uiRunButton = (await page.locator(".stage-run").count()) >= 1;
await page.screenshot({ path: "m4_stages.png" });
await browser.close();

// 정리: config manual 로 복원
await put("/stage/config", { parser: "manual", skeleton: "manual", content: "manual" });
await post("/ingest/reset-mock");

out.consoleErrors = errs;
console.log(JSON.stringify(out, null, 2));

const ok =
  out.startNodes === 11 &&
  out.manual400 === 400 &&
  out.echoStatus === 200 && out.echoAdopted === true && out.afterEcho === 12 &&
  out.brokenStatus === 422 && out.afterBroken === 12 &&
  out.uiExternalBadge === true && out.uiRunButton === true &&
  errs.length === 0;
process.exit(ok ? 0 : 1);
