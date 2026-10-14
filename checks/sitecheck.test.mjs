import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkSite, checkPage, format, digits, lineOf } from "./sitecheck.mjs";

const GOOD_HEAD = `<meta name="viewport" content="width=device-width"><title>Plumber</title>
<meta name="description" content="d"><meta property="og:title" content="t">
<meta property="og:description" content="d"><meta property="og:image" content="i.png">`;

const page = (body, head = GOOD_HEAD) => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
const rules = (src, file = "/s/index.html") => checkPage(file, src, "/s").map((x) => x.rule);

test("a clean page has no findings", () => {
  assert.deepEqual(rules(page('<p>Call <a href="tel:+12175550142">217-555-0142</a></p>')), []);
});

test("missing viewport, title and description are reported", () => {
  const r = rules(page("<p>hi</p>", ""));
  for (const k of ["viewport-missing", "title-missing", "meta-description-missing", "og-missing"]) assert.ok(r.includes(k), k);
});

test("a plain-text phone number is an error with a ready tel: fix", () => {
  const [f] = checkPage("/s/index.html", page("<p>Call 217-555-0142 today</p>"), "/s");
  assert.equal(f.rule, "phone-not-tappable");
  assert.equal(f.severity, "error");
  assert.match(f.fix, /tel:\+12175550142/);
});

test("phone numbers inside links, scripts and comments are ignored", () => {
  assert.deepEqual(rules(page('<a href="tel:+12175550142">(217) 555-0142</a><!-- 217-555-0142 --><script>x="217-555-0142"</script>')), []);
});

test("JSON-LD that does not parse is an error", () => {
  assert.ok(rules(page('<script type="application/ld+json">{"@type": "Plumber",}</script>')).includes("jsonld-invalid"));
});

test("a tel: link that disagrees with the JSON-LD phone is an error", () => {
  const ld = '<script type="application/ld+json">{"@type":"Plumber","name":"x","address":"y","telephone":"+1-217-555-0142"}</script>';
  assert.ok(rules(page(`${ld}<a href="tel:+12175550199">call</a>`)).includes("phone-mismatch"));
  assert.ok(!rules(page(`${ld}<a href="tel:+12175550142">call</a>`)).includes("phone-mismatch"));
});

test("incomplete business JSON-LD is a warning", () => {
  const ld = '<script type="application/ld+json">{"@type":"Dentist","name":"x"}</script>';
  assert.ok(rules(page(ld)).includes("jsonld-incomplete"));
});

test("http resources are mixed content; http links are not", () => {
  const r = rules(page('<img alt="" src="http://cdn.example/a.png"><a href="http://example.com">x</a>'));
  assert.deepEqual(r, ["mixed-content"]);
});

test("images without alt and unlabelled fields are reported", () => {
  const r = rules(page('<img src="a.png"><form><input name="email"><input type="hidden" name="t"><label>Name <input name="n"></label><label for="p">P</label><input id="p"></form>'));
  assert.deepEqual(r.sort(), ["form-label-missing", "img-alt-missing"]);
});

test("broken internal links and anchors are found against the real tree", () => {
  const dir = mkdtempSync(join(tmpdir(), "sitecheck-"));
  mkdirSync(join(dir, "sub"));
  writeFileSync(join(dir, "index.html"), page('<a href="sub/ok.html">ok</a> <a href="gone.html">gone</a> <a href="#nope">x</a> <a href="#top" id="top">t</a>'));
  writeFileSync(join(dir, "sub", "ok.html"), page('<a href="../index.html">home</a>'));
  const r = checkSite(dir).map((x) => `${x.file}:${x.rule}`);
  assert.deepEqual(r.sort(), ["index.html:broken-anchor", "index.html:broken-link"]);
});

test("reports carry line numbers and render as junit and code quality", () => {
  const src = page("\n\n<p>217-555-0142</p>");
  const fs = checkPage("/s/a.html", src, "/s");
  assert.equal(fs[0].line, src.slice(0, src.indexOf("217-")).split("\n").length);
  const junit = format(fs, "junit", ["a.html", "b.html"]);
  assert.match(junit, /tests="2" failures="1"/);
  const cq = JSON.parse(format(fs, "codequality", ["a.html"]));
  assert.equal(cq[0].location.path, "site/a.html");
  assert.equal(cq[0].severity, "major");
});

test("digits normalises US numbers", () => {
  assert.equal(digits("+1 (217) 555-0142"), "2175550142");
  assert.equal(lineOf("a\nb\nc", 4), 3);
});
