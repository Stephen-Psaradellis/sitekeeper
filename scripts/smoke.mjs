#!/usr/bin/env node
// Smoke test a deployed site: every page answers 200, carries the expected build
// version, and still has a tappable phone link. With --wait N it polls up to N
// seconds for the new version to appear (Pages takes a minute to publish).
//
//   node scripts/smoke.mjs <base-url> --version <sha> [--pages site] [--wait 300] [--junit out.xml]
import { readdirSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i < 0 ? d : args.splice(i, 2)[1]; };
const version = opt("--version", process.env.CI_COMMIT_SHORT_SHA || "local");
const pagesDir = opt("--pages", "site");
const wait = Number(opt("--wait", 0));
const junit = opt("--junit", null);
const base = (args[0] || "http://localhost:8080").replace(/\/?$/, "/");
const pages = readdirSync(pagesDir).filter((n) => n.endsWith(".html")).sort();

async function probe(page) {
  try {
    const r = await fetch(base + page, { redirect: "follow", cache: "no-store" });
    const html = await r.text();
    const live = /name="sitekeeper-version" content="([^"]*)"/.exec(html)?.[1];
    const problems = [];
    if (r.status !== 200) problems.push(`HTTP ${r.status}`);
    if (live !== version) problems.push(`version ${live ?? "missing"} != ${version}`);
    if (r.status === 200 && !/href="tel:/.test(html)) problems.push("no tel: link");
    return { page, problems };
  } catch (e) {
    return { page, problems: [`fetch failed: ${e.message}`] };
  }
}

const deadline = Date.now() + wait * 1000;
let results;
for (;;) {
  results = await Promise.all(pages.map(probe));
  const stale = results.some((r) => r.problems.some((p) => p.startsWith("version")));
  if (!stale || Date.now() >= deadline) break;
  await new Promise((r) => setTimeout(r, 15000));
}
const failed = results.filter((r) => r.problems.length);
for (const r of results) console.log(`${r.problems.length ? "FAIL" : "ok  "} ${base}${r.page}${r.problems.length ? "  " + r.problems.join("; ") : ""}`);
if (junit) {
  const esc = (s) => s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]);
  const cases = results.map((r) => `<testcase classname="smoke" name="${esc(r.page)}">${r.problems.map((p) => `<failure message="${esc(p)}"/>`).join("")}</testcase>`);
  writeFileSync(junit, `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="smoke" tests="${results.length}" failures="${failed.length}">${cases.join("")}</testsuite>\n`);
}
console.log(`smoke: ${results.length - failed.length}/${results.length} pages healthy at version ${version}`);
process.exitCode = failed.length ? 1 : 0;
