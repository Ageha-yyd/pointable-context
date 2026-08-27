import type { PointableInteractionObserverRequest } from "../host/codex-cdp/adapter.js";
import {
  RecoveryObservationAdapter,
  type RecoveryObservationAcceptance,
  type RecoveryObservationResult,
} from "./recovery-observation-adapter.js";
import type {
  RecoveryEpisodeDefinition,
  RecoveryEpisodeOutcome,
} from "./recovery-observation.js";

export interface RecoveryObservationHostStatus {
  active: boolean;
  eventCount: number;
}

/**
 * Connects privacy-bounded native interaction signals to one explicit recovery
 * episode per active Codex task. The task fingerprint is used only as an
 * in-memory routing key and is never copied into an observation event.
 */
export class RecoveryObservationHostBridge {
  readonly #adapter: RecoveryObservationAdapter;

  constructor(adapter = new RecoveryObservationAdapter()) {
    this.#adapter = adapter;
  }

  readonly observe = (
    request: Readonly<PointableInteractionObserverRequest>,
  ): RecoveryObservationAcceptance =>
    this.#adapter.record(request.scopeKey, request.signal);

  begin(scopeKey: string, definition: RecoveryEpisodeDefinition): void {
    this.#adapter.begin(scopeKey, definition);
  }

  complete(
    scopeKey: string,
    outcome: RecoveryEpisodeOutcome,
  ): RecoveryObservationResult {
    return this.#adapter.complete(scopeKey, outcome);
  }

  abort(scopeKey: string): RecoveryObservationResult {
    return this.#adapter.abort(scopeKey);
  }

  status(scopeKey: string): RecoveryObservationHostStatus {
    return Object.freeze({
      active: this.#adapter.active(scopeKey),
      eventCount: this.#adapter.eventCount(scopeKey),
    });
  }
}
