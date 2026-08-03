import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.env.PORT ?? "4173");
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8"
};

const server = http.createServer((request, response) => {
  const requestPath = new URL(request.url ?? "/", `http://${request.headers.host}`).pathname;
  const normalized = requestPath === "/" ? "/index.html" : requestPath;
  let filePath = path.join(root, normalized);

  if (!filePath.startsWith(root)) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(root, "index.html");
  }

  const ext = path.extname(filePath);
  response.setHeader("Content-Type", mimeTypes[ext] ?? "application/octet-stream");
  response.setHeader("Cache-Control", "no-cache");
  fs.createReadStream(filePath).pipe(response);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Serving dist on http://127.0.0.1:${port}`);
});
