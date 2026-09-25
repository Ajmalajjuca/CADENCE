import { after } from "next/server";
import { ServerConfigurationError } from "../config-error";
import { wakeWorker } from "./wake";

export function scheduleWorkerWake(schedule: typeof after = after): void {
  schedule(async () => {
    try {
      const result = await wakeWorker();
      if (result.outcome === "failed") {
        console.error(`Worker wake failed${result.status ? ` with status ${result.status}` : ""}.`);
      }
    } catch (error) {
      const category = error instanceof ServerConfigurationError ? "configuration" : "unexpected";
      console.error(`Worker wake failed: ${category}.`);
    }
  });
}
