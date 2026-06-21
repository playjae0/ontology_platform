// M2 검증 — 화면1 데이터 관리: 깨진 업로드 거부(채택 비활성) / 정상 검증→채택→카운트 갱신 / 롤백.
import { chromium } from "playwright";
import { readFileSync } from "fs";

const URL = "http://localhost:5173/";
const out = {};
const errs = [];

// 정상 확장 skeleton: mock + 신규 proposed 노드(기존 노드 보존 → SSOT 교차검증 통과)
const sk = JSON.parse(readFileSync("../data/mock/assembly_skeleton.json", "utf-8"));
sk.nodes["N0103"] = { id: "N0103", canonical_name: "레이저노칭기", category: "Unit",
  definition: "", aliases: ["laser notcher"], attached_to: "N0001", spec: null,
  status: "proposed", provenance: [], embedding: null };
sk.edges.push({ source: "N0103", relation: "part_of", target: "N0001",
  evidence: "manual", status: "proposed", provenance: [] });
const validJson = JSON.stringify(sk, null, 2);

const brokenJson = JSON.stringify({
  nodes: { N0001: { id: "N0001", canonical_name: "노칭", category: "Process", status: "confirmed", aliases: [] } },
  edges: [{ source: "N0001", relation: "part_of", target: "N9999", status: "confirmed" }],
}, null, 2);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
page.on("pageerror", (e) => errs.push(String(e)));

await page.goto(URL, { waitUntil: "load" });
await page.click(".nav button:has-text('데이터 관리')");
await page.waitForSelector(".slot-card");

const skeletonCard = page.locator(".slot-card").first(); // SLOTS[0] = skeleton
const ta = skeletonCard.locator(".slot-textarea");
const validateBtn = skeletonCard.getByRole("button", { name: "검증" });
const adoptBtn = skeletonCard.getByRole("button", { name: /채택/ });

// 1) 깨진 업로드 → 검증 → 실패 + 채택 비활성
await ta.fill(brokenJson);
await validateBtn.click();
await skeletonCard.locator(".result-bad").waitFor({ timeout: 5000 });
out.brokenMsg = (await skeletonCard.locator(".error-list li").first().textContent())?.trim();
out.adoptDisabledOnBroken = await adoptBtn.isDisabled();

// SSOT 불변 확인(상단 카운트 11)
out.countsAfterBroken = (await page.textContent(".topbar-counts"))?.trim();

// 2) 정상 업로드 → 검증 통과 → 채택 → 카운트 12
await ta.fill(validJson);
await validateBtn.click();
await skeletonCard.locator(".result-ok").waitFor({ timeout: 5000 });
out.adoptEnabledOnValid = !(await adoptBtn.isDisabled());
await adoptBtn.click();
await page.waitForFunction(
  () => document.querySelector(".topbar-counts")?.textContent?.includes("노드 12"),
  { timeout: 5000 },
);
out.countsAfterAdopt = (await page.textContent(".topbar-counts"))?.trim();

await page.screenshot({ path: "m2_datamanage.png" });

// 3) 롤백 → 11
await page.getByRole("button", { name: /직전 롤백/ }).click();
await page.waitForFunction(
  () => document.querySelector(".topbar-counts")?.textContent?.includes("노드 11"),
  { timeout: 5000 },
);
out.countsAfterRollback = (await page.textContent(".topbar-counts"))?.trim();

await browser.close();
out.consoleErrors = errs;
console.log(JSON.stringify(out, null, 2));

const ok =
  out.adoptDisabledOnBroken === true &&
  out.countsAfterBroken?.includes("노드 11") &&
  out.adoptEnabledOnValid === true &&
  out.countsAfterAdopt?.includes("노드 12") &&
  out.countsAfterRollback?.includes("노드 11") &&
  errs.length === 0;
process.exit(ok ? 0 : 1);
