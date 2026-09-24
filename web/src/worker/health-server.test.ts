import { afterEach, expect, it } from "vitest";
import type { Server } from "node:http";
import { runWithWorkerHealthServer, startWorkerHealthServer } from "./health-server";

let server: Server | undefined;

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server?.close(error => error ? reject(error) : resolve());
    });
    server = undefined;
  }
});

it("serves a successful health response for Render", async () => {
  server = await startWorkerHealthServer(0);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Health server did not bind to a TCP port");

  const response = await fetch(`http://127.0.0.1:${address.port}/health`);

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: "ok" });
});

it("closes the health listener when the worker loop fails", async () => {
  let rejectLoop!: (error: Error) => void;
  const loop = new Promise<void>((_resolve, reject) => { rejectLoop = reject; });
  let reportListening!: (server: Server) => void;
  const listening = new Promise<Server>(resolve => { reportListening = resolve; });

  const runtime = runWithWorkerHealthServer(0, () => loop, reportListening);
  const runningServer = await listening;
  const address = runningServer.address();
  if (!address || typeof address === "string") throw new Error("Health server did not bind to a TCP port");
  const url = `http://127.0.0.1:${address.port}/health`;
  expect((await fetch(url)).status).toBe(200);

  rejectLoop(new Error("polling failed"));

  await expect(runtime).rejects.toThrow("polling failed");
  await expect(fetch(url)).rejects.toThrow();
});
