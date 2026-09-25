"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CreationRunJson } from "../../server/db/types";

const POLL_INTERVAL_MS = 2_500;
const LOAD_ERROR = "Could not load your saved progress.";

export type CreationRunState = {
  run: CreationRunJson | null;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
};

export function useCreationRun(runId: string): CreationRunState {
  const [run, setRun] = useState<CreationRunJson | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pollTick, setPollTick] = useState(0);
  const mounted = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const request = useRef<AbortController | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const load = useCallback(async () => {
    clearTimer();
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;

    try {
      const response = await fetch(`/api/creation-runs/${runId}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Creation run request failed");
      const data = await response.json() as CreationRunJson;
      if (!mounted.current || request.current !== controller) return;

      setRun(data);
      setError("");
      setLoading(false);
      const shouldPoll = data.status === "queued" || data.status === "running";
      if (shouldPoll && document.visibilityState === "visible") {
        timer.current = setTimeout(() => setPollTick((value) => value + 1), POLL_INTERVAL_MS);
      }
    } catch (loadError) {
      if (!mounted.current || request.current !== controller) return;
      if (loadError instanceof DOMException && loadError.name === "AbortError") return;
      setError(LOAD_ERROR);
      setLoading(false);
    } finally {
      if (request.current === controller) request.current = null;
    }
  }, [clearTimer, runId]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimer();
      request.current?.abort();
      request.current = null;
    };
  }, [clearTimer]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) void load(); });
    return () => { cancelled = true; };
  }, [load, pollTick]);

  useEffect(() => {
    function handleVisibilityChange() {
      clearTimer();
      if (document.visibilityState === "visible") setPollTick((value) => value + 1);
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [clearTimer]);

  return { run, loading, error, refresh: load };
}
