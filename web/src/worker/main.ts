import { readServerConfig } from "../server/config";
import { claimNextRun } from "../server/db/jobs";
import { makeProcessDependencies, processCreationRun } from "./process-run";
import { randomUUID } from "node:crypto";
import { handleRunFailure, loadAiForRun } from "./ai-for-run";
import { AiServiceError } from "../server/ai/provider-errors";

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
      const code = error instanceof AiServiceError ? error.code : "GENERATION_FAILED";
      process.stderr.write(`Run ${run.id} failed at ${run.stage}: ${code}\n`);
    }
  }
}

void loop().catch(error => { process.stderr.write(`Worker stopped: ${error instanceof Error ? error.message : "Unknown error"}\n`); process.exitCode = 1; });
