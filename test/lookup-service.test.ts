import assert from "node:assert/strict";
import test from "node:test";
import type {
  AuthorityResult,
  AuthoritativeProvider,
  ContextBindingPort,
  ContextBindingResult,
  ContextIndexPort,
  ExplicitLookupIntent,
  HostContext,
  IdentityRecord,
  SelectionInput,
  TrustedContextBinding,
} from "../src/contracts.js";
import { LookupService } from "../src/lookup-service.js";
import {
  contextScope,
  identity,
  PROJECT_SCOPE,
  snapshot,
  trustedBinding,
} from "./helpers.js";

class StubBinding implements ContextBindingPort {
  resolveCalls = 0;
  revalidateCalls = 0;
  throwOnResolve = false;
  throwOnRevalidate = false;
  resolveSignals: Array<AbortSignal | undefined> = [];
  revalidateSignals: Array<AbortSignal | undefined> = [];

  constructor(
    public resolveResult: ContextBindingResult = trustedBinding(),
    public revalidateResults: ContextBindingResult[] = [trustedBinding()],
  ) {}

  async resolve(
    _context: HostContext,
    signal?: AbortSignal,
  ): Promise<ContextBindingResult> {
    this.resolveCalls += 1;
    this.resolveSignals.push(signal);
    if (this.throwOnResolve) throw new Error("binding offline");
    return this.resolveResult;
  }

  async revalidate(
    _binding: TrustedContextBinding,
    signal?: AbortSignal,
  ): Promise<ContextBindingResult> {
    this.revalidateCalls += 1;
    this.revalidateSignals.push(signal);
    if (this.throwOnRevalidate) throw new Error("binding offline");
    return this.revalidateResults[
      Math.min(this.revalidateCalls - 1, this.revalidateResults.length - 1)
    ]!;
  }
}

class StubIndex implements ContextIndexPort {
  calls = 0;
  signals: Array<AbortSignal | undefined> = [];

  constructor(public records: IdentityRecord[], public error?: Error) {}

  async list(
    _binding: TrustedContextBinding,
    signal?: AbortSignal,
  ): Promise<IdentityRecord[]> {
    this.calls += 1;
    this.signals.push(signal);
    if (this.error) throw this.error;
    return this.records;
  }
}

class StubProvider implements AuthoritativeProvider {
  readonly providerId = "stub";
  calls: Array<{ entityId: string; entityType: string; locator: string }> = [];
  signals: Array<AbortSignal | undefined> = [];

  constructor(public result: AuthorityResult | unknown, public error?: Error) {}

  async getDetail(request: {
    binding: TrustedContextBinding;
    entityId: string;
    entityType: string;
    authorityLocator: string;
    revisionPolicy: "current-or-explicit-stale";
    signal?: AbortSignal;
  }): Promise<AuthorityResult> {
    this.signals.push(request.signal);
    this.calls.push({
      entityId: request.entityId,
      entityType: request.entityType,
      locator: request.authorityLocator,
    });
    if (this.error) throw this.error;
    return this.result as AuthorityResult;
  }
}

function never<T>(): Promise<T> {
  return new Promise<T>(() => undefined);
}

function verifiedSnapshot(
  entityId = "WU:GOV-1",
  overrides: Parameters<typeof snapshot>[1] = {},
): AuthorityResult {
  return {
    kind: "snapshot",
    snapshot: snapshot(entityId, overrides),
    verification: {
      verifiedAt: new Date().toISOString(),
      method: "live_read",
    },
  };
}

function selection(
  text: string,
  overrides: Partial<SelectionInput> = {},
): SelectionInput {
  return {
    text,
    surface: "assistant_message",
    selectionGeneration: 1,
    ...overrides,
  };
}

function hostContext(overrides: Partial<HostContext> = {}): HostContext {
  return {
    explicitScope: PROJECT_SCOPE,
    selectionGeneration: 1,
    threadRef: "thread-1",
    routeRef: "chat",
    workspaceRoot: "D:/fixture",
    ...overrides,
  };
}

function activatedIntent(
  service: LookupService,
  text: string,
  options: {
    chosenEntityId?: string;
    selection?: Partial<SelectionInput>;
    hostContext?: Partial<HostContext>;
  } = {},
): ExplicitLookupIntent {
  const selected = selection(text, options.selection);
  const context = hostContext(options.hostContext);
  const issued = service.issueActivation(
    selected,
    context,
    options.chosenEntityId,
  );
  assert.equal(issued.kind, "issued");
  if (issued.kind !== "issued") throw new Error("activation was not issued");
  return {
    ...issued.ticket,
    selection: selected,
    hostContext: context,
    ...(options.chosenEntityId
      ? { chosenEntityId: options.chosenEntityId }
      : {}),
  };
}

test("missing context binding stops before index and authority access", async () => {
  const binding = new StubBinding({ kind: "missing" });
  const index = new StubIndex([identity("WU:GOV-1", "GOV-1")]);
  const provider = new StubProvider(verifiedSnapshot());
  const service = new LookupService(binding, index, [provider]);
  const outcome = await service.submitLookupIntent(
    activatedIntent(service, "GOV-1"),
  );

  assert.equal(outcome.kind, "blocked");
  if (outcome.kind === "blocked") {
    assert.equal(outcome.reason, "context_binding_missing");
  }
  assert.equal(index.calls, 0);
  assert.equal(provider.calls.length, 0);
});

test("selection generation mismatch is ineligible before context binding", () => {
  const binding = new StubBinding();
  const service = new LookupService(binding, new StubIndex([]), []);
  const issued = service.issueActivation(
    selection("GOV-1"),
    hostContext({ selectionGeneration: 2 }),
  );
  assert.deepEqual(issued, { kind: "ineligible", reason: "invalid_generation" });
  assert.equal(binding.resolveCalls, 0);
});

test("activation requires one explicit valid context scope", () => {
  const binding = new StubBinding();
  const service = new LookupService(binding, new StubIndex([]), []);
  const missing = service.issueActivation(selection("GOV-1"), {
    selectionGeneration: 1,
    threadRef: "thread-1",
    routeRef: "chat",
    workspaceRoot: "D:/fixture",
  });
  assert.deepEqual(missing, { kind: "ineligible", reason: "missing_scope" });

  const invalid = service.issueActivation(selection("GOV-1"), {
    explicitScope: {
      kind: "project",
      namespace: "",
      id: "PRJ-01",
    },
    selectionGeneration: 1,
  });
  assert.deepEqual(invalid, {
    kind: "ineligible",
    reason: "invalid_host_context",
  });
  assert.equal(binding.resolveCalls, 0);
});

test("binding scope getters are read once then pinned before intent matching", async () => {
  const base = trustedBinding();
  const { scope: _scope, ...rawFields } = base;
  let scopeReads = 0;
  const rawBinding = {
    ...rawFields,
    get scope() {
      scopeReads += 1;
      return scopeReads === 1
        ? PROJECT_SCOPE
        : contextScope("external", "attacker", "attacker");
    },
  } as ContextBindingResult;
  const binding = new StubBinding(rawBinding, [trustedBinding(), trustedBinding()]);
  let capturedBinding: TrustedContextBinding | undefined;
  const index: ContextIndexPort = {
    async list(pinnedBinding) {
      capturedBinding = pinnedBinding;
      return [identity("WU:GOV-1", "GOV-1")];
    },
  };
  const provider = new StubProvider(verifiedSnapshot());
  const service = new LookupService(binding, index, [provider]);

  const outcome = await service.submitLookupIntent(
    activatedIntent(service, "GOV-1"),
  );
  assert.equal(outcome.kind, "detail");
  assert.equal(scopeReads, 1);
  assert.ok(capturedBinding);
  assert.equal(Object.isFrozen(capturedBinding), true);
  assert.equal(Object.isFrozen(capturedBinding.scope), true);
  assert.deepEqual(capturedBinding.scope, PROJECT_SCOPE);
});

test("unique exact match reads one authoritative detail and returns text fallback", async () => {
  const binding = new StubBinding();
  const index = new StubIndex([identity("WU:GOV-1", "GOV-1")]);
  const provider = new StubProvider(verifiedSnapshot());
  const service = new LookupService(binding, index, [provider]);
  const outcome = await service.submitLookupIntent(
    activatedIntent(service, "请查看 GOV-1"),
  );

  assert.equal(outcome.kind, "detail");
  assert.equal(provider.calls.length, 1);
  assert.equal(binding.revalidateCalls, 2);
  if (outcome.kind === "detail") {
    assert.match(outcome.fallbackText, /Revision: r1/u);
    assert.match(outcome.fallbackText, /Freshness: current/u);
    assert.match(outcome.fallbackText, /^Sources: 1\/1$/mu);
    assert.match(outcome.fallbackText, /^Source 1 type: test$/mu);
    assert.match(outcome.fallbackText, /^Source 1 id: source-1$/mu);
  }
});

test("two candidates revalidate once and do not prefetch detail", async () => {
  const binding = new StubBinding();
  const index = new StubIndex([
    identity("WU:A", "A-1", { aliases: ["harness"] }),
    identity("WU:B", "B-1", { aliases: ["harness"] }),
  ]);
  const provider = new StubProvider(verifiedSnapshot("WU:A"));
  const service = new LookupService(binding, index, [provider]);
  const outcome = await service.submitLookupIntent(
    activatedIntent(service, "harness"),
  );

  assert.equal(outcome.kind, "candidates");
  assert.equal(binding.revalidateCalls, 1);
  assert.equal(provider.calls.length, 0);
  if (outcome.kind === "candidates") {
    assert.equal(outcome.candidates.length, 2);
    assert.ok(
      outcome.candidates.every(
        (candidate) => candidate.detailFreshness === "unknown",
      ),
    );
  }
});

test("candidate choice reads only the chosen entity", async () => {
  const index = new StubIndex([
    identity("WU:A", "A-1", { aliases: ["harness"] }),
    identity("WU:B", "B-1", { aliases: ["harness"] }),
  ]);
  const provider = new StubProvider(verifiedSnapshot("WU:B"));
  const service = new LookupService(new StubBinding(), index, [provider]);
  const outcome = await service.submitLookupIntent(
    activatedIntent(service, "harness", { chosenEntityId: "WU:B" }),
  );

  assert.equal(outcome.kind, "detail");
  assert.deepEqual(provider.calls, [
    { entityId: "WU:B", entityType: "work_unit", locator: "loc/WU:B" },
  ]);
});

test("invalid candidate selection fails without detail access", async () => {
  const index = new StubIndex([
    identity("WU:A", "A-1", { aliases: ["harness"] }),
    identity("WU:B", "B-1", { aliases: ["harness"] }),
  ]);
  const provider = new StubProvider(verifiedSnapshot("WU:A"));
  const service = new LookupService(new StubBinding(), index, [provider]);
  const outcome = await service.submitLookupIntent(
    activatedIntent(service, "harness", { chosenEntityId: "WU:OTHER" }),
  );

  assert.equal(outcome.kind, "blocked");
  assert.equal(provider.calls.length, 0);
});

test("overflow and no-match routes revalidate and make zero detail calls", async () => {
  const provider = new StubProvider(verifiedSnapshot());
  const overflowBinding = new StubBinding();
  const overflowIndex = new StubIndex(
    ["A", "B", "C", "D"].map((key) =>
      identity(`WU:${key}`, `${key}-1`, { aliases: ["shared"] }),
    ),
  );
  const overflowService = new LookupService(
    overflowBinding,
    overflowIndex,
    [provider],
  );
  const overflowOutcome = await overflowService.submitLookupIntent(
    activatedIntent(overflowService, "shared"),
  );
  assert.equal(overflowOutcome.kind, "overflow");
  assert.equal(overflowBinding.revalidateCalls, 1);

  const noMatchBinding = new StubBinding();
  const noMatchService = new LookupService(
    noMatchBinding,
    new StubIndex([identity("WU:OTHER", "OTHER-1")]),
    [provider],
  );
  const noMatchOutcome = await noMatchService.submitLookupIntent(
    activatedIntent(noMatchService, "GOV-1"),
  );
  assert.equal(noMatchOutcome.kind, "no_match");
  assert.equal(noMatchBinding.revalidateCalls, 1);
  assert.equal(provider.calls.length, 0);
});

test("context change after index prevents candidate disclosure", async () => {
  const binding = new StubBinding(trustedBinding(), [{ kind: "context_changed" }]);
  const provider = new StubProvider(verifiedSnapshot("WU:A"));
  const service = new LookupService(
    binding,
    new StubIndex([
      identity("WU:A", "A-1", { aliases: ["harness"] }),
      identity("WU:B", "B-1", { aliases: ["harness"] }),
    ]),
    [provider],
  );
  const outcome = await service.submitLookupIntent(
    activatedIntent(service, "harness"),
  );
  assert.equal(outcome.kind, "blocked");
  if (outcome.kind === "blocked") assert.equal(outcome.reason, "context_changed");
  assert.equal(provider.calls.length, 0);
});

test("trusted binding must remain bound to the activated selection and evidence", async () => {
  const generationBinding = new StubBinding(
    trustedBinding({ selectionGeneration: 2 }),
  );
  const generationService = new LookupService(
    generationBinding,
    new StubIndex([identity("WU:GOV-1", "GOV-1")]),
    [],
  );
  const generationOutcome = await generationService.submitLookupIntent(
    activatedIntent(generationService, "GOV-1"),
  );
  assert.equal(generationOutcome.kind, "blocked");
  if (generationOutcome.kind === "blocked") {
    assert.equal(generationOutcome.reason, "context_changed");
  }

  const evidenceBinding = new StubBinding(trustedBinding(), [
    trustedBinding({ evidence: "verified_workspace" }),
  ]);
  const evidenceService = new LookupService(
    evidenceBinding,
    new StubIndex([identity("WU:GOV-1", "GOV-1")]),
    [],
  );
  const evidenceOutcome = await evidenceService.submitLookupIntent(
    activatedIntent(evidenceService, "GOV-1"),
  );
  assert.equal(evidenceOutcome.kind, "blocked");
  if (evidenceOutcome.kind === "blocked") {
    assert.equal(evidenceOutcome.reason, "context_changed");
  }

  const scopeDrifts = [
    contextScope("thread", PROJECT_SCOPE.id, PROJECT_SCOPE.namespace),
    contextScope(PROJECT_SCOPE.kind, PROJECT_SCOPE.id, "other-host"),
    contextScope(PROJECT_SCOPE.kind, "PRJ-02", PROJECT_SCOPE.namespace),
  ];
  for (const driftedScope of scopeDrifts) {
    const scopeBinding = new StubBinding(trustedBinding(), [
      trustedBinding({ scope: driftedScope }),
    ]);
    const scopeService = new LookupService(
      scopeBinding,
      new StubIndex([identity("WU:GOV-1", "GOV-1")]),
      [],
    );
    const scopeOutcome = await scopeService.submitLookupIntent(
      activatedIntent(scopeService, "GOV-1"),
    );
    assert.deepEqual(scopeOutcome.kind, "blocked");
    if (scopeOutcome.kind === "blocked") {
      assert.equal(scopeOutcome.reason, "context_changed");
    }
  }
});

test("host anchors and evidence-specific anchors fail closed unless exact", async () => {
  async function submitWith(
    bindingResult: ContextBindingResult,
    context: HostContext,
  ) {
    const binding = new StubBinding(bindingResult);
    const index = new StubIndex([identity("WU:GOV-1", "GOV-1")]);
    const service = new LookupService(binding, index, []);
    const selected = selection("GOV-1");
    const issued = service.issueActivation(selected, context);
    assert.equal(issued.kind, "issued");
    if (issued.kind !== "issued") throw new Error("activation not issued");
    const outcome = await service.submitLookupIntent({
      ...issued.ticket,
      selection: selected,
      hostContext: context,
    });
    return { outcome, index };
  }

  const baseHost = hostContext();
  const { threadRef: _thread, ...withoutThread } = baseHost;
  const { workspaceRoot: _workspace, ...withoutWorkspace } = baseHost;
  const cases: Array<[ContextBindingResult, HostContext]> = [
    [trustedBinding({ evidence: "verified_thread" }), withoutThread],
    [trustedBinding({ evidence: "verified_workspace" }), withoutWorkspace],
    [trustedBinding(), { ...baseHost, routeRef: "other-route" }],
    [trustedBinding(), { ...baseHost, workspaceRoot: "D:/other" }],
  ];
  for (const [bindingResult, context] of cases) {
    const { outcome, index } = await submitWith(bindingResult, context);
    assert.equal(outcome.kind, "blocked");
    if (outcome.kind === "blocked") {
      assert.equal(outcome.reason, "context_changed");
    }
    assert.equal(index.calls, 0);
  }

  const threadBound = trustedBinding({ evidence: "verified_thread" });
  const { threadRef: _missingThread, ...missingThreadAnchor } = threadBound;
  const workspaceBound = trustedBinding({ evidence: "verified_workspace" });
  const { workspaceRoot: _missingWorkspace, ...missingWorkspaceAnchor } =
    workspaceBound;
  for (const malformed of [missingThreadAnchor, missingWorkspaceAnchor]) {
    const { outcome, index } = await submitWith(
      malformed as ContextBindingResult,
      baseHost,
    );
    assert.equal(outcome.kind, "blocked");
    if (outcome.kind === "blocked") {
      assert.equal(outcome.reason, "context_binding_unavailable");
    }
    assert.equal(index.calls, 0);
  }
});

test("malformed binding, index, and provider envelopes fail closed", async () => {
  const malformedBinding = new StubBinding(
      null as unknown as ContextBindingResult,
  );
  const bindingService = new LookupService(
    malformedBinding,
    new StubIndex([]),
    [],
  );
  const bindingOutcome = await bindingService.submitLookupIntent(
    activatedIntent(bindingService, "GOV-1"),
  );
  assert.equal(bindingOutcome.kind, "blocked");
  if (bindingOutcome.kind === "blocked") {
    assert.equal(bindingOutcome.reason, "context_binding_unavailable");
  }

  const badRecord = {
    ...identity("WU:GOV-1", "GOV-1"),
    aliases: "not-an-array",
  } as unknown as IdentityRecord;
  const indexService = new LookupService(
    new StubBinding(),
    new StubIndex([badRecord]),
    [],
  );
  const indexOutcome = await indexService.submitLookupIntent(
    activatedIntent(indexService, "GOV-1"),
  );
  assert.equal(indexOutcome.kind, "blocked");
  if (indexOutcome.kind === "blocked") {
    assert.equal(indexOutcome.reason, "authority_contract_invalid");
  }

  const providerService = new LookupService(
    new StubBinding(),
    new StubIndex([identity("WU:GOV-1", "GOV-1")]),
    [new StubProvider(null)],
  );
  const providerOutcome = await providerService.submitLookupIntent(
    activatedIntent(providerService, "GOV-1"),
  );
  assert.equal(providerOutcome.kind, "blocked");
  if (providerOutcome.kind === "blocked") {
    assert.equal(providerOutcome.reason, "authority_contract_invalid");
  }
});

test("oversized hostile index is blocked before record access or revalidation", async () => {
  let propertyReads = 0;
  const poison = new Proxy(
    {},
    {
      get() {
        propertyReads += 1;
        throw new Error("oversized records must remain untouched");
      },
    },
  ) as IdentityRecord;
  const binding = new StubBinding();
  const provider = new StubProvider(verifiedSnapshot());
  const service = new LookupService(
    binding,
    new StubIndex(Array(10_000).fill(poison)),
    [provider],
  );

  const outcome = await service.submitLookupIntent(
    activatedIntent(service, "GOV-1"),
  );
  assert.equal(outcome.kind, "blocked");
  if (outcome.kind === "blocked") {
    assert.equal(outcome.reason, "authority_contract_invalid");
  }
  assert.equal(propertyReads, 0);
  assert.equal(binding.revalidateCalls, 0);
  assert.equal(provider.calls.length, 0);
});

test("cross-scope and duplicate index identities are rejected before resolution", async () => {
  const invalidIndexes = [
    [
      identity("WU:OTHER", "OTHER-1", {
        scope: contextScope("project", "PRJ-02"),
      }),
    ],
    [
      identity("WU:GOV-1", "GOV-1"),
      identity("WU:GOV-1", "GOV-2"),
    ],
    [
      identity("WU:GOV-1", "GOV-1"),
      identity("WU:GOV-2", "ｇｏｖ－１"),
    ],
  ];

  for (const records of invalidIndexes) {
    const service = new LookupService(
      new StubBinding(),
      new StubIndex(records),
      [],
    );
    const outcome = await service.submitLookupIntent(
      activatedIntent(service, "GOV-1"),
    );
    assert.equal(outcome.kind, "blocked");
    if (outcome.kind === "blocked") {
      assert.equal(outcome.reason, "authority_contract_invalid");
    }
  }
});

test("authority identity mismatch and unregistered provider fail closed", async () => {
  const record = identity("WU:GOV-1", "GOV-1");
  const mismatch = new StubProvider(verifiedSnapshot("WU:OTHER"));
  const mismatchService = new LookupService(
    new StubBinding(),
    new StubIndex([record]),
    [mismatch],
  );
  const mismatchOutcome = await mismatchService.submitLookupIntent(
    activatedIntent(mismatchService, "GOV-1"),
  );
  assert.equal(mismatchOutcome.kind, "blocked");
  if (mismatchOutcome.kind === "blocked") {
    assert.equal(mismatchOutcome.reason, "authority_identity_mismatch");
  }

  const unregisteredService = new LookupService(
    new StubBinding(),
    new StubIndex([record]),
    [],
  );
  const unregisteredOutcome = await unregisteredService.submitLookupIntent(
    activatedIntent(unregisteredService, "GOV-1"),
  );
  assert.equal(unregisteredOutcome.kind, "blocked");
  if (unregisteredOutcome.kind === "blocked") {
    assert.equal(unregisteredOutcome.reason, "provider_unregistered");
  }
});

test("malformed custom-provider snapshots fail at the authority boundary", async () => {
  const provider = new StubProvider({
    kind: "snapshot",
    snapshot: {
      ...snapshot(),
      freshness: "BOGUS",
      facts: { status: { nested: true } },
    },
    verification: {
      verifiedAt: new Date().toISOString(),
      method: "live_read",
    },
  });
  const service = new LookupService(
    new StubBinding(),
    new StubIndex([identity("WU:GOV-1", "GOV-1")]),
    [provider],
  );
  const outcome = await service.submitLookupIntent(
    activatedIntent(service, "GOV-1"),
  );
  assert.equal(outcome.kind, "blocked");
  if (outcome.kind === "blocked") {
    assert.equal(outcome.reason, "authority_contract_invalid");
  }
});

test("future authority timestamps fail as contract errors", async () => {
  const provider = new StubProvider(
    verifiedSnapshot("WU:GOV-1", {
      observedAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    }),
  );
  const service = new LookupService(
    new StubBinding(),
    new StubIndex([identity("WU:GOV-1", "GOV-1")]),
    [provider],
  );
  const outcome = await service.submitLookupIntent(
    activatedIntent(service, "GOV-1"),
  );
  assert.equal(outcome.kind, "blocked");
  if (outcome.kind === "blocked") {
    assert.equal(outcome.reason, "authority_contract_invalid");
  }
});

test("context change after authority read prevents stale mount", async () => {
  const binding = new StubBinding(trustedBinding(), [
    trustedBinding(),
    { kind: "context_changed" },
  ]);
  const provider = new StubProvider(verifiedSnapshot());
  const service = new LookupService(
    binding,
    new StubIndex([identity("WU:GOV-1", "GOV-1")]),
    [provider],
  );
  const outcome = await service.submitLookupIntent(
    activatedIntent(service, "GOV-1"),
  );
  assert.equal(outcome.kind, "blocked");
  if (outcome.kind === "blocked") assert.equal(outcome.reason, "context_changed");
  assert.equal(provider.calls.length, 1);
});

test("activation ticket cannot be forged, rebound, or replayed", async () => {
  const provider = new StubProvider(verifiedSnapshot());
  const binding = new StubBinding();
  const service = new LookupService(
    binding,
    new StubIndex([identity("WU:GOV-1", "GOV-1")]),
    [provider],
  );

  const forged = await service.submitLookupIntent({
    activationNonce: "act:caller-created",
    activatedAt: Date.now(),
    selection: selection("GOV-1"),
    hostContext: hostContext(),
  });
  assert.equal(forged.kind, "blocked");
  assert.equal(binding.resolveCalls, 0);

  const rebound = activatedIntent(service, "GOV-1");
  rebound.hostContext = hostContext({ threadRef: "other-thread" });
  const reboundOutcome = await service.submitLookupIntent(rebound);
  assert.equal(reboundOutcome.kind, "blocked");
  assert.equal(binding.resolveCalls, 0);

  const scopeRebounds = [
    contextScope("thread", PROJECT_SCOPE.id, PROJECT_SCOPE.namespace),
    contextScope(PROJECT_SCOPE.kind, PROJECT_SCOPE.id, "other-host"),
    contextScope(PROJECT_SCOPE.kind, "PRJ-02", PROJECT_SCOPE.namespace),
  ];
  for (const reboundScope of scopeRebounds) {
    const scopeRebound = activatedIntent(service, "GOV-1");
    scopeRebound.hostContext = hostContext({ explicitScope: reboundScope });
    const scopeReboundOutcome = await service.submitLookupIntent(scopeRebound);
    assert.equal(scopeReboundOutcome.kind, "blocked");
    if (scopeReboundOutcome.kind === "blocked") {
      assert.equal(scopeReboundOutcome.reason, "invalid_activation");
    }
  }
  assert.equal(binding.resolveCalls, 0);

  const request = activatedIntent(service, "GOV-1");
  assert.equal((await service.submitLookupIntent(request)).kind, "detail");
  const replay = await service.submitLookupIntent(request);
  assert.equal(replay.kind, "blocked");
  if (replay.kind === "blocked") {
    assert.equal(replay.reason, "replayed_activation");
  }
  assert.equal(provider.calls.length, 1);
});

test("activation capacity fails closed without evicting a live ticket", async () => {
  const service = new LookupService(new StubBinding(), new StubIndex([]), []);
  const first = activatedIntent(service, "GOV-1");
  for (let index = 1; index < 4_096; index += 1) {
    const issued = service.issueActivation(
      selection(`GOV-${index + 1}`),
      hostContext(),
    );
    assert.equal(issued.kind, "issued");
  }
  assert.deepEqual(
    service.issueActivation(selection("GOV-overflow"), hostContext()),
    { kind: "capacity_exceeded" },
  );
  assert.equal((await service.submitLookupIntent(first)).kind, "no_match");
});

test("binding exceptions become structured fail-closed outcomes", async () => {
  const resolveBinding = new StubBinding();
  resolveBinding.throwOnResolve = true;
  const resolveService = new LookupService(resolveBinding, new StubIndex([]), []);
  const resolveOutcome = await resolveService.submitLookupIntent(
    activatedIntent(resolveService, "GOV-1"),
  );
  assert.equal(resolveOutcome.kind, "blocked");
  if (resolveOutcome.kind === "blocked") {
    assert.equal(resolveOutcome.reason, "context_binding_unavailable");
  }

  const revalidateBinding = new StubBinding();
  revalidateBinding.throwOnRevalidate = true;
  const revalidateService = new LookupService(
    revalidateBinding,
    new StubIndex([identity("WU:GOV-1", "GOV-1")]),
    [],
  );
  const revalidateOutcome = await revalidateService.submitLookupIntent(
    activatedIntent(revalidateService, "GOV-1"),
  );
  assert.equal(revalidateOutcome.kind, "blocked");
  if (revalidateOutcome.kind === "blocked") {
    assert.equal(revalidateOutcome.reason, "context_binding_unavailable");
  }
});

test("provider access and availability states remain explicit", async () => {
  const record = identity("WU:GOV-1", "GOV-1");
  const accessService = new LookupService(
    new StubBinding(),
    new StubIndex([record]),
    [new StubProvider({ kind: "access_denied" })],
  );
  const accessDenied = await accessService.submitLookupIntent(
    activatedIntent(accessService, "GOV-1"),
  );
  assert.equal(accessDenied.kind, "blocked");

  const unavailableService = new LookupService(
    new StubBinding(),
    new StubIndex([record]),
    [new StubProvider({ kind: "unavailable", retryable: true })],
  );
  const unavailable = await unavailableService.submitLookupIntent(
    activatedIntent(unavailableService, "GOV-1"),
  );
  assert.equal(unavailable.kind, "unavailable");
  if (unavailable.kind === "unavailable") {
    assert.equal(unavailable.retryable, true);
  }
});

function assertOperationTimeout(outcome: Awaited<ReturnType<LookupService["submitLookupIntent"]>>): void {
  assert.equal(outcome.kind, "unavailable");
  if (outcome.kind === "unavailable") {
    assert.equal(outcome.reason, "operation_timeout");
    assert.equal(outcome.retryable, true);
  }
}

test("never-resolving binding resolve is aborted at its operation deadline", async () => {
  let receivedSignal: AbortSignal | undefined;
  const binding: ContextBindingPort = {
    resolve: async (_context, signal) => {
      receivedSignal = signal;
      return never<ContextBindingResult>();
    },
    revalidate: async () => trustedBinding(),
  };
  const service = new LookupService(binding, new StubIndex([]), [], {
    operationTimeoutMs: 20,
  });

  const outcome = await service.submitLookupIntent(
    activatedIntent(service, "GOV-1"),
  );
  assertOperationTimeout(outcome);
  assert.ok(receivedSignal);
  assert.equal(receivedSignal.aborted, true);
});

test("never-resolving index list is aborted at its operation deadline", async () => {
  let receivedSignal: AbortSignal | undefined;
  const index: ContextIndexPort = {
    list: async (_binding, signal) => {
      receivedSignal = signal;
      return never<IdentityRecord[]>();
    },
  };
  const service = new LookupService(new StubBinding(), index, [], {
    operationTimeoutMs: 20,
  });

  const outcome = await service.submitLookupIntent(
    activatedIntent(service, "GOV-1"),
  );
  assertOperationTimeout(outcome);
  assert.ok(receivedSignal);
  assert.equal(receivedSignal.aborted, true);
});

test("never-resolving binding revalidation is aborted at its deadline", async () => {
  let receivedSignal: AbortSignal | undefined;
  const binding: ContextBindingPort = {
    resolve: async () => trustedBinding(),
    revalidate: async (_binding, signal) => {
      receivedSignal = signal;
      return never<ContextBindingResult>();
    },
  };
  const service = new LookupService(binding, new StubIndex([]), [], {
    operationTimeoutMs: 20,
  });

  const outcome = await service.submitLookupIntent(
    activatedIntent(service, "GOV-1"),
  );
  assertOperationTimeout(outcome);
  assert.ok(receivedSignal);
  assert.equal(receivedSignal.aborted, true);
});

test("never-resolving provider is aborted and does not trigger post-read revalidation", async () => {
  let receivedSignal: AbortSignal | undefined;
  const provider: AuthoritativeProvider = {
    providerId: "stub",
    getDetail: async (request) => {
      receivedSignal = request.signal;
      return never<AuthorityResult>();
    },
  };
  const binding = new StubBinding();
  const service = new LookupService(
    binding,
    new StubIndex([identity("WU:GOV-1", "GOV-1")]),
    [provider],
    { operationTimeoutMs: 20 },
  );

  const outcome = await service.submitLookupIntent(
    activatedIntent(service, "GOV-1"),
  );
  assertOperationTimeout(outcome);
  assert.ok(receivedSignal);
  assert.equal(receivedSignal.aborted, true);
  assert.equal(binding.revalidateCalls, 1);
});

test("caller abort interrupts an in-flight provider and reaches its combined signal", async () => {
  let receivedSignal: AbortSignal | undefined;
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const provider: AuthoritativeProvider = {
    providerId: "stub",
    getDetail: async (request) => {
      receivedSignal = request.signal;
      markStarted();
      return never<AuthorityResult>();
    },
  };
  const service = new LookupService(
    new StubBinding(),
    new StubIndex([identity("WU:GOV-1", "GOV-1")]),
    [provider],
    { operationTimeoutMs: 5_000 },
  );
  const controller = new AbortController();
  const pending = service.submitLookupIntent(
    activatedIntent(service, "GOV-1"),
    controller.signal,
  );
  await started;
  controller.abort("caller stopped lookup");
  const outcome = await pending;

  assert.equal(outcome.kind, "blocked");
  if (outcome.kind === "blocked") assert.equal(outcome.reason, "request_aborted");
  assert.ok(receivedSignal);
  assert.equal(receivedSignal.aborted, true);
});

test("a pre-aborted caller does no work and does not consume the activation", async () => {
  const binding = new StubBinding();
  const service = new LookupService(binding, new StubIndex([]), []);
  const intent = activatedIntent(service, "GOV-1");
  const controller = new AbortController();
  controller.abort();

  const aborted = await service.submitLookupIntent(intent, controller.signal);
  assert.equal(aborted.kind, "blocked");
  if (aborted.kind === "blocked") assert.equal(aborted.reason, "request_aborted");
  assert.equal(binding.resolveCalls, 0);

  const retried = await service.submitLookupIntent(intent);
  assert.equal(retried.kind, "no_match");
  assert.equal(binding.resolveCalls, 1);
});

test("an immediate caller abort prevents a queued port invocation", async () => {
  const binding = new StubBinding();
  const service = new LookupService(binding, new StubIndex([]), []);
  const controller = new AbortController();
  const pending = service.submitLookupIntent(
    activatedIntent(service, "GOV-1"),
    controller.signal,
  );

  controller.abort("cancel before the port microtask");
  const outcome = await pending;

  assert.equal(outcome.kind, "blocked");
  if (outcome.kind === "blocked") assert.equal(outcome.reason, "request_aborted");
  assert.equal(binding.resolveCalls, 0);
});

test("a synchronously blocking port cannot report success after its deadline", async () => {
  let receivedSignal: AbortSignal | undefined;
  const binding: ContextBindingPort = {
    resolve: async (_context, signal) => {
      receivedSignal = signal;
      const stopAt = Date.now() + 30;
      while (Date.now() < stopAt) {
        // Simulate a broken adapter that blocks before returning its promise.
      }
      return trustedBinding();
    },
    revalidate: async () => trustedBinding(),
  };
  const service = new LookupService(binding, new StubIndex([]), [], {
    operationTimeoutMs: 10,
  });

  const outcome = await service.submitLookupIntent(
    activatedIntent(service, "GOV-1"),
  );

  assertOperationTimeout(outcome);
  assert.ok(receivedSignal);
  assert.equal(receivedSignal.aborted, true);
});

test("successful port calls clear deadlines instead of being aborted later", async () => {
  const binding = new StubBinding();
  const index = new StubIndex([identity("WU:GOV-1", "GOV-1")]);
  const provider = new StubProvider(verifiedSnapshot());
  const service = new LookupService(binding, index, [provider], {
    operationTimeoutMs: 20,
  });
  const outcome = await service.submitLookupIntent(
    activatedIntent(service, "GOV-1"),
  );
  assert.equal(outcome.kind, "detail");

  await new Promise<void>((resolve) => setTimeout(resolve, 40));
  const signals = [
    ...binding.resolveSignals,
    ...binding.revalidateSignals,
    ...index.signals,
    ...provider.signals,
  ];
  assert.equal(signals.length, 5);
  assert.ok(signals.every((signal) => signal !== undefined && !signal.aborted));
});

test("operation timeout configuration remains finite and freshness-compatible", () => {
  for (const operationTimeoutMs of [0, 9, 30_001, Number.POSITIVE_INFINITY, 12.5]) {
    assert.throws(
      () =>
        new LookupService(new StubBinding(), new StubIndex([]), [], {
          operationTimeoutMs,
        }),
      RangeError,
    );
  }
});
