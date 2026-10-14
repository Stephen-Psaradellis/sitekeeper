#!/usr/bin/env node
// Copy site/ to public/ and stamp every page with the commit it was built from,
// so the health check can prove which build is actually live.
import { cpSync, rmSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const version = process.env.CI_COMMIT_SHORT_SHA || "local";
const [src, out] = [process.argv[2] || "site", process.argv[3] || "public"];
rmSync(out, { recursive: true, force: true });
cpSync(src, out, { recursive: true });
const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
let pages = 0;
for (const p of walk(out).filter((p) => p.endsWith(".html"))) {
  writeFileSync(p, readFileSync(p, "utf8").replaceAll("__VERSION__", version));
  pages++;
}
writeFileSync(join(out, "version.txt"), version + "\n");
console.log(`build: ${pages} pages -> ${out}/ (version ${version})`);
