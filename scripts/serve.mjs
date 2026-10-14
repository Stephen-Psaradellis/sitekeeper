#!/usr/bin/env node
// Minimal static server for the pre-production check: serve public/ exactly as Pages would.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, normalize, extname } from "node:path";

const [root, port] = [process.argv[2] || "public", Number(process.argv[3] || 8080)];
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".svg": "image/svg+xml", ".txt": "text/plain", ".js": "text/javascript" };
createServer(async (req, res) => {
  let path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^[/\\]+/, "");
  if (!path || path.endsWith("/") || path.endsWith("\\")) path += "index.html";
  try {
    const body = await readFile(join(root, path));
    res.writeHead(200, { "content-type": types[extname(path)] || "application/octet-stream" }).end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(port, () => console.log(`serve: ${root}/ on http://localhost:${port}`));
