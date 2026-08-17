export type SourceSurface =
  | "assistant_message"
  | "user_message"
  | "composer"
  | "navigation"
  | "terminal"
  | "diff"
  | "browser"
  | "iframe"
  | "detached";

export interface SelectionInput {
  text: string;
  surface: SourceSurface;
  selectionGeneration: number;
}

export type EligibilityReason =
  | "unsupported_surface"
  | "empty_selection"
  | "selection_too_long"
  | "invalid_generation"
  | "missing_scope"
  | "invalid_host_context";

export type EligibilityResult =
  | { kind: "eligible"; selection: SelectionInput }
  | { kind: "ineligible"; reason: EligibilityReason };

export type ContextScopeKind =
  | "thread"
  | "workspace"
  | "project"
  | "collection"
  | "external";

/**
 * Stable identity of the bounded context searched by one lookup.
 * `namespace` prevents equal local IDs issued by different hosts/providers
 * from being treated as the same scope.
 */
export interface ContextScopeRef {
  kind: ContextScopeKind;
  namespace: string;
  id: string;
}

export interface HostContext {
  selectionGeneration: number;
  /** Host-private requested scope; it is not trusted until the binding port verifies it. */
  explicitScope?: ContextScopeRef;
  threadRef?: string;
  routeRef?: string;
  workspaceRoot?: string;
}

export type BindingEvidence =
  | "verified_thread"
  | "verified_workspace"
  | "explicit_user"
  | "fixture_manifest";

export interface TrustedContextBinding {
  kind: "trusted";
  scope: ContextScopeRef;
  bindingRevision: string;
  evidence: BindingEvidence;
  selectionGeneration: number;
  threadRef?: string;
  routeRef?: string;
  workspaceRoot?: string;
}

export type ContextBindingResult =
  | TrustedContextBinding
  | { kind: "missing" }
  | { kind: "ambiguous"; scopes: ContextScopeRef[] }
  | { kind: "context_changed" };

export interface AuthorityRef {
  provider: string;
  locator: string;
}

export interface IdentityRecord {
  schemaVersion: "1.0";
  scope: ContextScopeRef;
  entityId: string;
  entityType: string;
  canonicalKey?: string;
  canonicalName: string;
  aliases: string[];
  summary: string;
  authorityRef: AuthorityRef;
  indexRevision: string;
  indexedAt: string;
  deleted: boolean;
}

export type MatchKind =
  | "exact_id"
  | "exact_name"
  | "exact_alias"
  | "normalized_exact";

export interface CandidateMatch {
  scope: ContextScopeRef;
  entityId: string;
  entityType: string;
  label: string;
  summary: string;
  matchKind: MatchKind;
  indexRevision: string;
  indexedAt: string;
  detailFreshness: "unknown";
}

export interface ResolvedCandidate {
  match: CandidateMatch;
  record: IdentityRecord;
}

export type ResolutionOutcome =
  | { kind: "no_match" }
  | { kind: "unique"; candidate: ResolvedCandidate }
  | { kind: "candidates"; candidates: ResolvedCandidate[] }
  | {
      kind: "overflow";
      candidateCount: number;
      reason: "too_many" | "mixed_types" | "ambiguous_normalized";
    };

export type FactScalar = string | number | boolean | null;
export type FactValue = FactScalar | FactScalar[];

export interface SourceRef {
  sourceType: string;
  sourceId: string;
}

export type Freshness = "current" | "stale" | "partial";

export interface DetailSnapshot {
  scope: ContextScopeRef;
  entityId: string;
  entityType: string;
  entityRevision: string;
  observedAt: string;
  freshness: Freshness;
  facts: Record<string, FactValue>;
  relations: string[];
  sourceRefs: SourceRef[];
}

export type AuthorityVerification =
  | { verifiedAt: string; method: "live_read" | "fixture_read" }
  | {
      verifiedAt: string;
      method: "revision_check";
      verifiedRevision: string;
    };

export type AuthorityResult =
  | {
      kind: "snapshot";
      snapshot: DetailSnapshot;
      verification: AuthorityVerification;
    }
  | { kind: "not_found" }
  | { kind: "access_denied" }
  | { kind: "unavailable"; retryable: boolean };

export interface ExplicitLookupIntent {
  activationNonce: string;
  activatedAt: number;
  selection: SelectionInput;
  hostContext: HostContext;
  chosenEntityId?: string;
}

export interface ActivationTicket {
  activationNonce: string;
  activatedAt: number;
}

export type ActivationIssueResult =
  | { kind: "issued"; ticket: ActivationTicket }
  | { kind: "ineligible"; reason: EligibilityReason }
  | { kind: "capacity_exceeded" };

export type BlockReason =
  | "invalid_activation"
  | "replayed_activation"
  | "context_changed"
  | "context_binding_missing"
  | "context_binding_ambiguous"
  | "context_binding_unavailable"
  | "invalid_candidate"
  | "provider_unregistered"
  | "authority_identity_mismatch"
  | "authority_contract_invalid"
  | "request_aborted"
  | "access_denied";

export type LookupOutcome =
  | {
      kind: "detail";
      candidate: CandidateMatch;
      detail: DetailSnapshot;
      verification: AuthorityVerification;
      fallbackText: string;
    }
  | { kind: "no_match"; fallbackText: string }
  | { kind: "candidates"; candidates: CandidateMatch[]; fallbackText: string }
  | {
      kind: "overflow";
      candidateCount: number;
      reason: "too_many" | "mixed_types" | "ambiguous_normalized";
      fallbackText: string;
    }
  | { kind: "blocked"; reason: BlockReason; fallbackText: string }
  | {
      kind: "unavailable";
      reason: "not_found" | "provider_unavailable" | "operation_timeout";
      retryable: boolean;
      fallbackText: string;
    };

export interface ContextBindingPort {
  resolve(context: HostContext, signal?: AbortSignal): Promise<ContextBindingResult>;
  /** Re-read the adapter's live authority; do not reuse a captured HostContext. */
  revalidate(
    binding: TrustedContextBinding,
    signal?: AbortSignal,
  ): Promise<ContextBindingResult>;
}

export interface ContextIndexPort {
  list(
    binding: TrustedContextBinding,
    signal?: AbortSignal,
  ): Promise<IdentityRecord[]>;
}

export interface AuthoritativeProvider {
  readonly providerId: string;
  getDetail(request: {
    binding: TrustedContextBinding;
    entityId: string;
    entityType: string;
    authorityLocator: string;
    revisionPolicy: "current-or-explicit-stale";
    signal?: AbortSignal;
  }): Promise<AuthorityResult>;
}
