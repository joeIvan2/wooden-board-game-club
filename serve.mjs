/**
 * serve.mjs — 原木棋社零依賴本機靜態伺服器。
 *
 *   node serve.mjs              → http://127.0.0.1:8787
 *   PORT=9000 node serve.mjs    → 指定埠
 *   HOST=0.0.0.0 node serve.mjs → 指定介面（預設只綁本機迴圈）
 */

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || "127.0.0.1";

const MIME = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
});

// Fairy-Stockfish 的 WASM threads 需要 cross-origin isolation；本機與 Pages
// 使用同一組回應標頭，避免本機可用、部署後退回的差異。
const ISOLATION_HEADERS = Object.freeze({
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "same-origin",
});

function resolveWithinRoot(urlPath) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(urlPath, "http://localhost").pathname);
  } catch {
    return null;
  }
  if (pathname.endsWith("/")) pathname += "index.html";
  const absolute = resolve(normalize(join(ROOT, pathname)));
  const rel = relative(ROOT, absolute);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return null;
  return absolute;
}

async function sendFile(res, filePath) {
  const body = await readFile(filePath);
  res.writeHead(200, {
    "Content-Type": MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream",
    "Content-Length": body.byteLength,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...ISOLATION_HEADERS,
  });
  res.end(body);
}

const server = createServer(async (req, res) => {
  const urlPath = req.url?.split("?")[0] ?? "/";
  try {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD" }).end("Method Not Allowed");
      return;
    }
    let filePath = resolveWithinRoot(urlPath);
    if (!filePath) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    try {
      const info = await stat(filePath);
      if (info.isDirectory()) filePath = join(filePath, "index.html");
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("404 Not Found");
      console.log(`${new Date().toISOString()} ${req.method} ${urlPath} 404`);
      return;
    }
    await sendFile(res, filePath);
    console.log(`${new Date().toISOString()} ${req.method} ${urlPath} 200`);
  } catch (error) {
    res.writeHead(500).end("Internal Server Error");
    console.error(`${new Date().toISOString()} ${req.method} ${urlPath} 500`, error);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`原木棋社已啟動：http://${HOST}:${PORT}`);
});
