#!/usr/bin/env node
// sitecheck: the defects that cost a small-business site calls and bookings.
// Zero dependencies, so it runs in any node image in CI and on a laptop.
//
//   node checks/sitecheck.mjs <dir> [--format text|json|junit|codequality] [--out file]
//
// Exit 1 when any finding has severity "error"; warnings never fail the build.
// The rules come from scanning 29k real local-business sites: these are the
// defects that showed up most and that a visitor actually feels.

import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, relative, dirname, resolve, extname } from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const PHONE = /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g;

export function lineOf(src, index) {
  let n = 1;
  for (let i = 0; i < index && i < src.length; i++) if (src.charCodeAt(i) === 10) n++;
  return n;
}

export function parseAttrs(s) {
  const out = {};
  const re = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m;
  while ((m = re.exec(s))) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  return out;
}

export function tags(src, name) {
  const re = new RegExp(`<${name}\\b([^>]*)>`, "gi");
  const out = [];
  let m;
  while ((m = re.exec(src))) out.push({ attrs: parseAttrs(m[1]), index: m.index });
  return out;
}

export const digits = (s) => {
  const d = String(s).replace(/\D/g, "");
  return d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
};

function textOutsideLinks(src) {
  // Blank out what a visitor cannot tap or read, keeping offsets so line numbers stay right.
  const blank = (m) => m.replace(/[^\n]/g, " ");
  return src
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/<script\b[\s\S]*?<\/script>/gi, blank)
    .replace(/<style\b[\s\S]*?<\/style>/gi, blank)
    .replace(/<a\b[\s\S]*?<\/a>/gi, blank)
    .replace(/<[^>]+>/g, blank);
}

function jsonLd(src) {
  const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const out = [];
  let m;
  while ((m = re.exec(src))) {
    try {
      out.push({ data: JSON.parse(m[1]), index: m.index });
    } catch (e) {
      out.push({ error: e.message, index: m.index });
    }
  }
  return out;
}

const BUSINESS = /LocalBusiness|Plumber|Electrician|HVACBusiness|Dentist|HomeAndConstructionBusiness|ProfessionalService|AutoRepair|Restaurant/;

export function checkPage(file, src, root) {
  const f = [];
  const add = (rule, severity, index, message, fix) =>
    f.push({ rule, severity, file: relative(root, file).replace(/\\/g, "/"), line: lineOf(src, index), message, fix });

  const head = src.search(/<\/head>/i);
  const headAt = head < 0 ? 0 : head;

  const metas = tags(src, "meta");
  const meta = (k, v) => metas.find((t) => (t.attrs[k] || "").toLowerCase() === v);

  if (!meta("name", "viewport"))
    add("viewport-missing", "error", headAt, "No mobile viewport: phones render the desktop page zoomed out.",
      'Add <meta name="viewport" content="width=device-width, initial-scale=1"> to <head>.');

  const title = /<title>([\s\S]*?)<\/title>/i.exec(src);
  if (!title || !title[1].trim())
    add("title-missing", "error", headAt, "Page has no <title>; search results show the URL instead.", "Add a <title> naming the service and town.");
  else if (title[1].trim().length > 65)
    add("title-long", "warning", title.index, `Title is ${title[1].trim().length} chars; search results cut it at ~60.`, "Shorten the <title> to 60 characters or fewer.");

  const desc = meta("name", "description");
  if (!desc || !desc.attrs.content?.trim())
    add("meta-description-missing", "warning", headAt, "No meta description; search engines invent a snippet.", "Add a 120-160 character meta description.");

  for (const p of ["og:title", "og:description", "og:image"])
    if (!meta("property", p))
      add("og-missing", "warning", headAt, `No ${p}: links shared on social or in texts show no preview.`, `Add <meta property="${p}" ...>.`);

  // Phone numbers a visitor cannot tap.
  const text = textOutsideLinks(src);
  let m;
  PHONE.lastIndex = 0;
  while ((m = PHONE.exec(text)))
    add("phone-not-tappable", "error", m.index, `Phone number "${m[0].trim()}" is plain text; on a phone it cannot be tapped to call.`,
      `Wrap it: <a href="tel:+1${digits(m[0])}">${m[0].trim()}</a>.`);

  const telLinks = tags(src, "a").filter((t) => (t.attrs.href || "").startsWith("tel:"));

  // Structured data: valid JSON, a business entity, and the same phone as the page.
  const lds = jsonLd(src);
  for (const ld of lds) {
    if (ld.error) {
      add("jsonld-invalid", "error", ld.index, `JSON-LD does not parse (${ld.error}); search engines ignore the whole block.`, "Fix the JSON syntax.");
      continue;
    }
    const items = [].concat(ld.data["@graph"] || ld.data);
    for (const it of items) {
      if (!BUSINESS.test(String(it["@type"] || ""))) continue;
      for (const k of ["name", "telephone", "address"])
        if (!it[k]) add("jsonld-incomplete", "warning", ld.index, `Business JSON-LD has no "${k}".`, `Add "${k}" to the ${it["@type"]} block.`);
      if (it.telephone && telLinks.length) {
        const want = digits(it.telephone);
        const bad = telLinks.filter((t) => digits(t.attrs.href) !== want);
        for (const t of bad)
          add("phone-mismatch", "error", t.index, `tel: link ${t.attrs.href} differs from the business phone ${it.telephone} in JSON-LD.`,
            "Use one phone number everywhere (page, links, structured data).");
      }
    }
  }

  // Mixed content: an http resource on an https page is blocked or flagged by browsers.
  const resources = [
    ...tags(src, "img").map((t) => [t, t.attrs.src]),
    ...tags(src, "script").map((t) => [t, t.attrs.src]),
    ...tags(src, "iframe").map((t) => [t, t.attrs.src]),
    ...tags(src, "link").filter((t) => /stylesheet|icon|preload/i.test(t.attrs.rel || "")).map((t) => [t, t.attrs.href]),
  ];
  for (const [t, url] of resources)
    if (url && /^http:\/\//i.test(url))
      add("mixed-content", "error", t.index, `Resource loaded over http (${url}); browsers block or warn on it.`, "Load it over https or from this site.");

  for (const t of tags(src, "img"))
    if (!("alt" in t.attrs))
      add("img-alt-missing", "warning", t.index, `Image ${t.attrs.src || ""} has no alt text.`, 'Add alt="" for decoration, or a short description.');

  // Form fields with no label: screen readers announce "edit text" and autofill guesses.
  const labelFor = new Set(tags(src, "label").map((t) => t.attrs.for).filter(Boolean));
  const fields = [...tags(src, "input"), ...tags(src, "select"), ...tags(src, "textarea")];
  for (const t of fields) {
    const type = (t.attrs.type || "").toLowerCase();
    if (["hidden", "submit", "button", "reset", "image"].includes(type)) continue;
    const labelled = (t.attrs.id && labelFor.has(t.attrs.id)) || t.attrs["aria-label"] || t.attrs["aria-labelledby"];
    // A field nested inside its <label> is labelled too.
    const before = src.slice(0, t.index);
    const open = before.lastIndexOf("<label"), close = before.lastIndexOf("</label");
    if (!labelled && !(open > close))
      add("form-label-missing", "error", t.index, `Form field ${t.attrs.name || t.attrs.id || ""} has no label.`, "Add <label for=...> or aria-label.");
  }

  // Internal links that go nowhere.
  const ids = new Set(tags(src, "[a-z][a-z0-9]*").map((t) => t.attrs.id).filter(Boolean));
  for (const t of tags(src, "a")) {
    const href = t.attrs.href;
    if (!href || /^(?:[a-z]+:|\/\/)/i.test(href)) continue;
    const [path, frag] = href.split("#");
    if (path) {
      const target = resolve(dirname(file), path.split("?")[0]);
      const ok = existsSync(target) && (statSync(target).isFile() || existsSync(join(target, "index.html")));
      if (!ok) add("broken-link", "error", t.index, `Link to ${href} points at a page that does not exist.`, "Fix the path or remove the link.");
    } else if (frag && !ids.has(frag)) {
      add("broken-anchor", "warning", t.index, `Link to #${frag} has no matching id on this page.`, `Add id="${frag}" to the target or fix the link.`);
    }
  }
  return f;
}

export function htmlFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...htmlFiles(p));
    else if (extname(name) === ".html") out.push(p);
  }
  return out.sort();
}

export function checkSite(dir) {
  const root = resolve(dir);
  return htmlFiles(root).flatMap((p) => checkPage(p, readFileSync(p, "utf8"), root));
}

const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]);

export function format(findings, kind, pages) {
  if (kind === "json") return JSON.stringify(findings, null, 2);
  if (kind === "codequality")
    // GitLab Code Quality report: shows each finding inline in the merge request.
    return JSON.stringify(findings.map((x) => ({
      description: `${x.message} Fix: ${x.fix}`,
      check_name: x.rule,
      fingerprint: createHash("md5").update(`${x.rule}|${x.file}|${x.line}|${x.message}`).digest("hex"),
      severity: x.severity === "error" ? "major" : "minor",
      location: { path: `site/${x.file}`, lines: { begin: x.line } },
    })), null, 2);
  if (kind === "junit") {
    // One test case per page, so the MR test widget shows which page broke.
    const byFile = new Map(pages.map((p) => [p, []]));
    for (const x of findings) byFile.get(x.file)?.push(x);
    const cases = [...byFile].map(([file, xs]) => {
      const errs = xs.filter((x) => x.severity === "error");
      const body = errs.map((x) => `<failure message="${esc(x.rule)}">${esc(`${x.file}:${x.line} ${x.message} Fix: ${x.fix}`)}</failure>`).join("");
      return `<testcase classname="sitecheck" name="${esc(file)}">${body}</testcase>`;
    });
    const fails = findings.filter((x) => x.severity === "error").length;
    return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="sitecheck" tests="${cases.length}" failures="${fails}">${cases.join("")}</testsuite>\n`;
  }
  if (!findings.length) return "sitecheck: no findings";
  return findings.map((x) => `${x.severity.toUpperCase().padEnd(7)} ${x.file}:${x.line} [${x.rule}] ${x.message}\n        fix: ${x.fix}`).join("\n");
}

function main(argv) {
  const args = argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i < 0 ? d : args.splice(i, 2)[1]; };
  const kind = opt("--format", "text");
  const out = opt("--out", null);
  const dir = args[0] || "site";
  const root = resolve(dir);
  const findings = checkSite(root);
  const pages = htmlFiles(root).map((p) => relative(root, p).replace(/\\/g, "/"));
  const text = format(findings, kind, pages);
  if (out) writeFileSync(out, text);
  else console.log(text);
  const errors = findings.filter((x) => x.severity === "error").length;
  console.error(`sitecheck: ${pages.length} pages, ${errors} errors, ${findings.length - errors} warnings`);
  return errors ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  process.exitCode = main(process.argv);
