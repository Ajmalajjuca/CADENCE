import { createServer, type Server } from "node:http";

export function startWorkerHealthServer(port: number): Promise<Server> {
  const server = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": "application/json",
      });
      response.end(JSON.stringify({ status: "ok" }));
      return;
    }

    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "Not found" }));
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

export async function runWithWorkerHealthServer(
  port: number,
  runWorkerLoop: () => Promise<void>,
  onListening?: (server: Server) => void,
): Promise<void> {
  const server = await startWorkerHealthServer(port);
  onListening?.(server);

  try {
    await runWorkerLoop();
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
}
