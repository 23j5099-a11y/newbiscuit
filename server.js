import { createServer } from "node:http";
import { readFile, readdir, mkdir, writeFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(root, "public");
const dataDir = join(root, "data");
const port = Number(process.env.PORT || 3000);

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp"
};

function sendJson(res, status, value) {
  res.writeHead(status, { "content-type": mime[".json"] });
  res.end(JSON.stringify(value));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function safePublicPath(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath.split("?")[0])).replace(/^(\.\.[/\\])+/, "");
  return join(publicDir, clean === "/" ? "index.html" : clean);
}

async function listImages() {
  const imageDir = join(publicDir, "images");
  const files = await readdir(imageDir);
  const ok = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"]);
  return files
    .filter((file) => ok.has(extname(file).toLowerCase()))
    .sort((a, b) => a.localeCompare(b))
    .map((file) => ({ id: file.replace(/\.[^.]+$/, ""), name: file.replace(/\.[^.]+$/, ""), src: `/images/${file}` }));
}

async function saveProject(project) {
  await mkdir(dataDir, { recursive: true });
  const payload = {
    ...project,
    savedAt: new Date().toISOString()
  };
  await writeFile(join(dataDir, "project.json"), JSON.stringify(payload, null, 2));
  return payload;
}

async function loadProject() {
  try {
    const text = await readFile(join(dataDir, "project.json"), "utf8");
    return JSON.parse(text);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/api/images") {
      sendJson(res, 200, await listImages());
      return;
    }

    if (req.method === "GET" && req.url === "/api/project") {
      sendJson(res, 200, { project: await loadProject() });
      return;
    }

    if (req.method === "POST" && req.url === "/api/project") {
      const body = await readBody(req);
      const project = await saveProject(JSON.parse(body || "{}"));
      sendJson(res, 200, { project });
      return;
    }

    const filePath = safePublicPath(req.url || "/");
    const info = await stat(filePath).catch(() => null);
    if (!info?.isFile()) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    const ext = extname(filePath).toLowerCase();
    res.writeHead(200, { "content-type": mime[ext] || "application/octet-stream" });
    createReadStream(filePath).pipe(res);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

server.listen(port, () => {
  console.log(`newbiscuit is running at http://localhost:${port}`);
});
