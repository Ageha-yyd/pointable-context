import {
  createFixturePrivateProbe,
  type FixturePrivateProbe,
  type FixturePrivateProbeOptions,
} from "./fixture-private-probe.js";
import type { CodexCdpHostAdapterStatus } from "./adapter.js";

const DEFAULT_REFRESH_INTERVAL_MS = 2_000;
const MIN_REFRESH_INTERVAL_MS = 100;
const MAX_REFRESH_INTERVAL_MS = 60_000;

export interface FixtureCompanionOptions extends FixturePrivateProbeOptions {
  refreshIntervalMs?: number;
}

export interface FixtureCompanionStatus {
  state: "idle" | "running" | "stopping" | "stopped";
  fixtureOnly: true;
  startedAt?: string;
  lastRefreshAt?: string;
  refreshCount: number;
  lastError?: string;
  adapter: CodexCdpHostAdapterStatus;
}

export interface FixtureCompanion {
  start(): Promise<FixtureCompanionStatus>;
  refresh(): Promise<FixtureCompanionStatus>;
  stop(): Promise<FixtureCompanionStatus>;
  status(): FixtureCompanionStatus;
}

function boundedRefreshInterval(value: number | undefined): number {
  const candidate = value ?? DEFAULT_REFRESH_INTERVAL_MS;
  if (
    !Number.isSafeInteger(candidate) ||
    candidate < MIN_REFRESH_INTERVAL_MS ||
    candidate > MAX_REFRESH_INTERVAL_MS
  ) {
    throw new RangeError(
      `refreshIntervalMs must be an integer from ${MIN_REFRESH_INTERVAL_MS} to ${MAX_REFRESH_INTERVAL_MS}`,
    );
  }
  return candidate;
}

function publicError(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message.slice(0, 512);
  }
  return "fixture companion refresh failed";
}

function immutableStatus(status: FixtureCompanionStatus): FixtureCompanionStatus {
  return Object.freeze({
    ...status,
    adapter: Object.freeze({
      ...status.adapter,
      targets: Object.freeze(
        status.adapter.targets.map((target) => Object.freeze({ ...target })),
      ),
    }),
  }) as FixtureCompanionStatus;
}

/**
 * Create an inert, fixture-only companion. start() is the first operation that
 * discovers Codex targets or injects the renderer.
 */
export function createFixtureCompanion(
  options: FixtureCompanionOptions,
): FixtureCompanion {
  const refreshIntervalMs = boundedRefreshInterval(options.refreshIntervalMs);
  const probe: FixturePrivateProbe = createFixturePrivateProbe(options);
  let state: FixtureCompanionStatus["state"] = "idle";
  let startedAt: string | undefined;
  let lastRefreshAt: string | undefined;
  let refreshCount = 0;
  let lastError: string | undefined;
  let refreshPromise: Promise<FixtureCompanionStatus> | undefined;
  let stopPromise: Promise<FixtureCompanionStatus> | undefined;
  let refreshTimer: NodeJS.Timeout | undefined;

  const status = (): FixtureCompanionStatus => immutableStatus({
    state,
    fixtureOnly: true,
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(lastRefreshAt === undefined ? {} : { lastRefreshAt }),
    refreshCount,
    ...(lastError === undefined ? {} : { lastError }),
    adapter: probe.status(),
  });

  const schedule = (): void => {
    if (state !== "running") return;
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      void refresh().finally(schedule);
    }, refreshIntervalMs);
  };

  const refresh = (): Promise<FixtureCompanionStatus> => {
    if (state === "stopping" || state === "stopped") {
      return Promise.resolve(status());
    }
    if (refreshPromise !== undefined) return refreshPromise;
    const operation = (async (): Promise<FixtureCompanionStatus> => {
      try {
        if (probe.status().state === "idle") {
          await probe.start();
        } else {
          await probe.adapter.refreshTargets();
        }
        lastError = undefined;
      } catch (error) {
        // A companion may start before Codex Desktop. Keep retrying while
        // exposing the discovery failure through status instead of claiming it
        // attached successfully.
        lastError = publicError(error);
      } finally {
        refreshCount += 1;
        lastRefreshAt = new Date().toISOString();
      }
      return status();
    })().finally(() => {
      if (refreshPromise === operation) refreshPromise = undefined;
    });
    refreshPromise = operation;
    return operation;
  };

  const start = async (): Promise<FixtureCompanionStatus> => {
    if (state === "stopped" || state === "stopping") {
      throw new Error("fixture_companion_stopped");
    }
    if (state === "running") return status();
    state = "running";
    startedAt = new Date().toISOString();
    await refresh();
    schedule();
    return status();
  };

  const stop = (): Promise<FixtureCompanionStatus> => {
    if (stopPromise !== undefined) return stopPromise;
    if (state === "stopped") return Promise.resolve(status());
    state = "stopping";
    if (refreshTimer !== undefined) {
      clearTimeout(refreshTimer);
      refreshTimer = undefined;
    }
    const operation = (async (): Promise<FixtureCompanionStatus> => {
      await refreshPromise?.catch(() => undefined);
      await probe.stop();
      state = "stopped";
      return status();
    })();
    stopPromise = operation;
    return operation;
  };

  return Object.freeze({ start, refresh, stop, status });
}
