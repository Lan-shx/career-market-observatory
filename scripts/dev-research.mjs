// Portable local preview with the exact Worker handler and SQLite SQL engine.
// Native D1 compatibility is tested separately against Miniflare.
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { researchRequest } from "../lib/research-server.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const sqlite = new DatabaseSync(
  path.resolve(
    process.env.JOBS_SQLITE || path.join(root, ".textsql/jobs.sqlite"),
  ),
);
export function sqliteBinding(db) {
  return {
    prepare(sql) {
      return {
        bind(...params) {
          return {
            async all() {
              return { results: db.prepare(sql).all(...params) };
            },
            async first() {
              return db.prepare(sql).get(...params) || null;
            },
            async run() {
              return { success: true, meta: db.prepare(sql).run(...params) };
            },
          };
        },
        async first() {
          return db.prepare(sql).get() || null;
        },
      };
    },
  };
}
const DB = sqliteBinding(sqlite),
  port = Number(process.env.PORT || 8788);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".geojson": "application/geo+json",
  ".svg": "image/svg+xml",
  ".gz": "application/gzip",
  ".txt": "text/plain; charset=utf-8",
};
const server = http.createServer(async (incoming, outgoing) => {
  const controller = new AbortController();
  outgoing.on("close", () => {
    if (!outgoing.writableEnded) controller.abort();
  });
  try {
    const url = new URL(incoming.url, `http://127.0.0.1:${port}`);
    if (url.pathname.startsWith("/api/research/")) {
      const init = {
        method: incoming.method,
        headers: incoming.headers,
        signal: controller.signal,
      };
      if (!["GET", "HEAD"].includes(incoming.method)) {
        init.body = incoming;
        init.duplex = "half";
      }
      const response = await researchRequest(new Request(url, init), {
        DB,
        DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
        DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL,
      });
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    if (!["GET", "HEAD"].includes(incoming.method)) {
      outgoing.writeHead(405);
      outgoing.end();
      return;
    }
    const name = decodeURIComponent(
        url.pathname === "/" ? "/index.html" : url.pathname,
      ),
      publicRoot = path.join(root, "public"),
      target = path.resolve(publicRoot, "." + name);
    if (
      !target.startsWith(publicRoot + path.sep) ||
      /(^|[\\/])\./.test(name) ||
      !(await stat(target)).isFile()
    )
      throw Error();
    outgoing.writeHead(200, {
      "content-type": mime[path.extname(target)] || "application/octet-stream",
    });
    outgoing.end(
      incoming.method === "HEAD" ? undefined : await readFile(target),
    );
  } catch {
    if (!outgoing.headersSent) outgoing.writeHead(404);
    outgoing.end("Not found");
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(`D1 research local preview: http://127.0.0.1:${port}`),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    server.close(() => {
      sqlite.close();
      process.exit();
    }),
  );
