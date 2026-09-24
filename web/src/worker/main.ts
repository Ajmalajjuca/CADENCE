import { readServerConfig } from "../server/config";
import { claimNextRun } from "../server/db/jobs";
import { makeProcessDependencies, processCreationRun } from "./process-run";
import { randomUUID } from "node:crypto";
import { describeRunFailure, handleRunFailure, loadAiForRun } from "./ai-for-run";
import { runWithWorkerHealthServer } from "./health-server";

readServerConfig("worker");
const workerId = randomUUID();
process.stdout.write(`Cadence worker ${workerId} started.\n`);

async function loop() {
  while (true) {
    const run = await claimNextRun(workerId);
    if (!run) { await new Promise(resolve => setTimeout(resolve, 2000)); continue; }
    let settingsRevision: number | undefined;
    try {
      const loaded = await loadAiForRun(run);
      settingsRevision = loaded.settingsRevision;
      await processCreationRun(run, makeProcessDependencies(loaded.ai));
    } catch (error) {
      try { await handleRunFailure(run, error, settingsRevision); }
      catch { process.stderr.write(`Run ${run.id} failure state could not be fully recorded.\n`); }
      process.stderr.write(`${describeRunFailure(run, error)}\n`);
    }
  }
}

async function main() {
  if (process.env.PORT) {
    await runWithWorkerHealthServer(Number(process.env.PORT), loop, server => {
      const address = server.address();
      const port = address && typeof address !== "string" ? address.port : process.env.PORT;
      process.stdout.write(`Worker health server listening on port ${port}.\n`);
    });
    return;
  }
  await loop();
}

void main().catch(error => { process.stderr.write(`Worker stopped: ${error instanceof Error ? error.message : "Unknown error"}\n`); process.exitCode = 1; });
