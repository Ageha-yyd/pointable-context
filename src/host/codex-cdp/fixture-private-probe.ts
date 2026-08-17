import {
  CodexCdpHostAdapter,
  type CodexCdpHostAdapterOptions,
  type CodexCdpHostAdapterStatus,
} from "./adapter.js";
import {
  createFixtureLookupCallback,
  type FixtureLookupCallbackOptions,
} from "./fixture-lookup.js";
import type { PointableFetch } from "./targets.js";
import type { CdpConnectionFactory } from "./transport.js";

/**
 * Explicit, fixture-only options for a private Codex Desktop probe.
 * Constructing a probe is inert; only start() performs discovery and injection.
 */
export interface FixturePrivateProbeOptions extends FixtureLookupCallbackOptions {
  endpoint?: string;
  fetch?: PointableFetch;
  connect?: CdpConnectionFactory;
  discoveryTimeoutMs?: number;
  lookupTimeoutMs?: number;
  maxConcurrentLookupsPerTarget?: number;
  actionLabel?: string;
}

export interface FixturePrivateProbe {
  readonly adapter: CodexCdpHostAdapter;
  start(signal?: AbortSignal): Promise<CodexCdpHostAdapterStatus>;
  stop(): Promise<CodexCdpHostAdapterStatus>;
  status(): CodexCdpHostAdapterStatus;
}

function adapterOptions(
  lookup: CodexCdpHostAdapterOptions["lookup"],
  options: FixturePrivateProbeOptions,
): CodexCdpHostAdapterOptions {
  return {
    lookup,
    ...(options.endpoint === undefined ? {} : { endpoint: options.endpoint }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.connect === undefined ? {} : { connect: options.connect }),
    ...(options.discoveryTimeoutMs === undefined
      ? {}
      : { discoveryTimeoutMs: options.discoveryTimeoutMs }),
    ...(options.lookupTimeoutMs === undefined
      ? {}
      : { lookupTimeoutMs: options.lookupTimeoutMs }),
    ...(options.maxConcurrentLookupsPerTarget === undefined
      ? {}
      : {
        maxConcurrentLookupsPerTarget:
          options.maxConcurrentLookupsPerTarget,
      }),
    ...(options.actionLabel === undefined
      ? {}
      : { actionLabel: options.actionLabel }),
  };
}

/** Create an inert private-probe handle. This function never discovers targets. */
export function createFixturePrivateProbe(
  options: FixturePrivateProbeOptions,
): FixturePrivateProbe {
  const lookup = createFixtureLookupCallback(options);
  const adapter = new CodexCdpHostAdapter(adapterOptions(lookup, options));
  return Object.freeze({
    adapter,
    start: (signal?: AbortSignal) => adapter.start(signal),
    stop: () => adapter.stop(),
    status: () => adapter.status(),
  });
}

/**
 * Opt-in private-probe entrypoint. Calling it performs CDP discovery/injection;
 * it is intentionally not wired to any package script, plugin, or default path.
 */
export async function startFixturePrivateProbe(
  options: FixturePrivateProbeOptions,
  signal?: AbortSignal,
): Promise<FixturePrivateProbe> {
  const probe = createFixturePrivateProbe(options);
  try {
    await probe.start(signal);
    return probe;
  } catch (error) {
    await probe.stop().catch(() => undefined);
    throw error;
  }
}
