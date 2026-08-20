import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import type { PointableFetch } from "../src/host/codex-cdp/targets.js";
import type {
  CdpConnection,
  CdpEvent,
} from "../src/host/codex-cdp/transport.js";
import { studyV2AssignmentForSlot } from "../src/evaluation/study-v2/contracts.js";
import {
  studyV2DoctorActions,
  type StudyV2DoctorResult,
} from "../src/evaluation/study-v2/doctor.js";
import { StudyV2NativeTrialHost } from "../src/evaluation/study-v2/native-trial-host.js";
import { createStudyV2NativeLookup } from "../src/evaluation/study-v2/native-trial-lookup.js";
import { loadStudyV2NativeTrialMaterial } from "../src/evaluation/study-v2/native-trial-pack.js";
import {
  parseStudyV2NativeEvent,
  validateStudyV2NativeSurfaceConfig,
} from "../src/evaluation/study-v2/native-trial-protocol.js";
import { createInstallStudyV2NativeTrialExpression } from "../src/evaluation/study-v2/native-trial-renderer.js";
import { createInstallStudyV2NativeAnswerControlExpression } from "../src/evaluation/study-v2/native-answer-control-renderer.js";
import { planStudyV2NativeTrial } from "../src/evaluation/study-v2/native-trial-runner.js";
import { StudyV2NativeQuestionnaireHost } from "../src/evaluation/study-v2/native-questionnaire-host.js";
import {
  parseStudyV2NativeQuestionnaireEvent,
  questionnaireFromNativeEvent,
  validateStudyV2NativeQuestionnaireSurfaceConfig,
} from "../src/evaluation/study-v2/native-questionnaire-protocol.js";
import { createInstallStudyV2NativeQuestionnaireExpression } from "../src/evaluation/study-v2/native-questionnaire-renderer.js";

const repositoryRoot = resolve(".");

const qualifiedDoctor = async (): Promise<StudyV2DoctorResult> => ({
  schemaVersion: 2,
  studyId: "pointable-context-study-v2",
  ready: true,
  platform: "win32",
  arch: "x64",
  nodeVersion: process.versions.node,
  codexPackageVersion: "26.810.7004.0",
  packDigest: "a".repeat(64),
  gates: {
    windowsX64: true,
    nodeRuntime: true,
    packIntegrity: true,
    codexBuildQualified: true,
    codexLoopbackAvailable: true,
    githubCliAvailable: false,
  },
  issues: ["github_cli_unavailable_for_submission"],
  actions: studyV2DoctorActions(["github_cli_unavailable_for_submission"]),
});

test("study doctor maps recurring environment failures to bounded owner actions", () => {
  assert.deepEqual(studyV2DoctorActions([
    "codex_loopback_unavailable",
    "codex_build_not_qualified",
    "github_cli_unavailable_for_submission",
  ]), [
    {
      issue: "codex_loopback_unavailable",
      owner: "participant",
      action: "Fully exit Codex, then run START-STUDY-SETUP.cmd before opening the setup task.",
    },
    {
      issue: "codex_build_not_qualified",
      owner: "organizer",
      action: "Qualify this exact Codex package and renderer digest; an older build record cannot be reused.",
    },
    {
      issue: "github_cli_unavailable_for_submission",
      owner: "participant",
      action: "Install GitHub CLI before submission or use the organizer's non-GitHub intake route; local practice may continue.",
    },
  ]);
});

function targetFetch(): PointableFetch {
  return async () => new Response(JSON.stringify([{
    id: "main-1",
    type: "page",
    title: "Codex",
    url: "app://-/index.html",
    webSocketDebuggerUrl: "ws://127.0.0.1:9223/devtools/page/main-1",
  }]), { status: 200 });
}

test("native trial material exposes decision-relevant objects instead of arbitrary files", async () => {
  const assignment = studyV2AssignmentForSlot(1).trials[0];
  assert.ok(assignment);
  const material = await loadStudyV2NativeTrialMaterial(repositoryRoot, assignment);
  assert.equal(material.answers.length, 3);
  assert.equal(material.entities.length, 1);
  assert.equal(material.conversation.exchanges.length, 5);
  assert.match(material.entities[0]?.meaning ?? "", /stable import boundary/iu);
  assert.match(
    material.conversation.exchanges.map((exchange) => exchange.assistant).join(" "),
    /relay-cache public entry/u,
  );
  assert.equal(material.entityTerms.some((term) => term.term.endsWith(".ts")), false);
  const chinese = await loadStudyV2NativeTrialMaterial(repositoryRoot, assignment, "zh-CN");
  assert.equal(chinese.language, "zh-CN");
  assert.equal(chinese.conversation.exchanges.length, 5);
  assert.match(chinese.entities[0]?.meaning ?? "", /稳定导入边界/u);
  assert.match(chinese.taskPrompt, /受支持导入边界/u);

  const plan = await planStudyV2NativeTrial({
    repositoryRoot,
    sessionId: "SESSION_0001",
    assignment,
    language: "en-US",
  }, { doctor: qualifiedDoctor });
  assert.equal(plan.ready, true);
  assert.equal(plan.liveModel, false);
  assert.equal(plan.nativeCodexSurface, true);
  assert.equal(plan.quietContextReveal, assignment.condition === "B");
  assert.equal("history" in plan, false);
});

test("native trial planning fails closed before mounting an unqualified Codex build", async () => {
  const assignment = studyV2AssignmentForSlot(1).trials[0];
  assert.ok(assignment);
  const plan = await planStudyV2NativeTrial({
    repositoryRoot,
    sessionId: "SESSION_0002",
    assignment,
  }, {
    doctor: async () => ({
      ...(await qualifiedDoctor()),
      ready: false,
      codexPackageVersion: "26.814.5517.0",
      gates: {
        ...(await qualifiedDoctor()).gates,
        codexBuildQualified: false,
      },
      issues: ["codex_build_not_qualified"],
    }),
  });
  assert.equal(plan.ready, false);
  assert.equal(plan.codexBuildQualified, false);
  assert.equal(plan.codexPackageVersion, "26.814.5517.0");
  assert.deepEqual(plan.issues, ["codex_build_not_qualified"]);
});

test("every counterbalanced assignment resolves to bounded native trial material", async () => {
  for (let slot = 1; slot <= 12; slot += 1) {
    for (const assignment of studyV2AssignmentForSlot(slot).trials) {
      const material = await loadStudyV2NativeTrialMaterial(repositoryRoot, assignment);
      assert.equal(material.assignment.condition, assignment.condition);
      assert.ok(material.history.length > 0 && material.history.length <= 24_000);
      assert.equal(material.answers.length, 3);
      assert.ok(material.entities.length >= 1 && material.entities.length <= 16);
      assert.ok(material.conversation.exchanges.length >= 2 && material.conversation.exchanges.length <= 8);
      assert.deepEqual(
        [...material.conversation.referencedEntityIds].sort(),
        material.entities.map((entity) => entity.id).sort(),
      );
    }
  }
});

test("native study lookup returns one P-C mental model only for an exact registered object", async () => {
  const assignment = studyV2AssignmentForSlot(1).trials[0];
  assert.ok(assignment);
  const material = await loadStudyV2NativeTrialMaterial(repositoryRoot, assignment);
  const lookup = createStudyV2NativeLookup(material, {
    revision: "a".repeat(64),
    observedAt: "2026-08-20T00:00:00.000Z",
  });
  const base = {
    operation: "resolve" as const,
    requestId: "request-12345678",
    selection: {
      text: material.entities[0]?.label ?? "",
      digest: "b".repeat(64),
      generation: 1,
      surface: "assistant_message" as const,
    },
    contextFingerprint: "context",
    requestedAt: "2026-08-20T00:00:00.000Z",
    host: {
      targetId: "main-1",
      targetUrl: "app://-/index.html",
      bindingGeneration: "binding-1",
    },
    signal: new AbortController().signal,
  };
  const detail = await lookup(base);
  assert.equal((detail as { kind: string }).kind, "detail");
  assert.equal(
    (detail as { detail: { comprehension: { kind: string } } }).detail.comprehension.kind,
    "concept",
  );
  const missing = await lookup({
    ...base,
    selection: { ...base.selection, text: "results.ts" },
  });
  assert.deepEqual(missing, {
    kind: "error",
    code: "study_object_not_found",
    message: "所选文字不是本试次的预注册对象。",
    retryable: false,
  });
});

test("native renderer is text-only, non-modal, trusted-action gated, and self-cleans terminal actions", () => {
  const config = validateStudyV2NativeSurfaceConfig({
    bindingName: `__pointableStudyBinding_${"a".repeat(32)}`,
    trialToken: "b".repeat(64),
    trialId: "S01-T1",
    scenarioId: "RESUME-1",
    condition: "B",
    language: "zh-CN",
    history: "The supported object is relay-cache public entry.",
    taskPrompt: "Choose the supported boundary.",
    answers: [
      { code: "RESUME-A", label: "A" },
      { code: "RESUME-B", label: "B" },
    ],
    entityTerms: [{ term: "relay-cache public entry", objectCode: "MODULE:RELAY-CACHE-ENTRY" }],
    timeoutMs: 300_000,
  });
  const expression = createInstallStudyV2NativeTrialExpression(config);
  assert.match(expression, /main\[data-app-shell-main-surface\]/u);
  assert.match(expression, /data-selected-text-overlay-target/u);
  assert.match(expression, /data-response-annotation-target/u);
  assert.match(expression, /event\.isTrusted/u);
  assert.match(expression, /textContent/u);
  assert.match(expression, /visibility:\s*"hidden"/u);
  assert.match(expression, /style\.visibility\s*=\s*"visible"/u);
  assert.match(expression, /right:\s*"20px"/u);
  assert.match(expression, /pointerEvents:\s*"none"/u);
  assert.match(expression, /pointerEvents:\s*"auto"/u);
  assert.match(expression, /stop\("completed"\)/u);
  assert.match(expression, /event\.key\s*!==\s*"Escape"/u);
  assert.doesNotMatch(expression, /aria-modal/u);
  assert.doesNotMatch(expression, /backdropFilter/u);
  assert.doesNotMatch(expression, /innerHTML/u);
  assert.doesNotMatch(expression, /STUDY_V2_[A-Z_]+/u);
  assert.doesNotMatch(expression, /sendFollowUpMessage|ui\/message|https?:\/\//u);
});

test("native answer control stays collapsed beside the Chat Lane and never renders a transcript overlay", () => {
  const expression = createInstallStudyV2NativeAnswerControlExpression(validateStudyV2NativeSurfaceConfig({
    bindingName: `__pointableStudyBinding_${"a".repeat(32)}`,
    trialToken: "b".repeat(64),
    trialId: "S01-T1",
    scenarioId: "RESUME-1",
    condition: "B",
    language: "zh-CN",
    history: "This legacy compatibility field must never be rendered by the answer control.",
    taskPrompt: "Choose the current supported import boundary.",
    answers: [
      { code: "RESUME-A", label: "Direct store" },
      { code: "RESUME-B", label: "Public entry" },
      { code: "RESUME-C", label: "Postpone" },
    ],
    entityTerms: [{ term: "relay-cache public entry", objectCode: "MODULE:RELAY-CACHE-ENTRY" }],
    timeoutMs: 300_000,
  }));
  assert.match(expression, /提交本轮答案/u);
  assert.match(expression, /panel\.hidden = true/u);
  assert.match(expression, /event\.isTrusted/u);
  assert.match(expression, /data-selected-text-overlay-target/u);
  assert.match(expression, /data-pointable-context-role/u);
  assert.match(expression, /workspace_left/u);
  assert.doesNotMatch(expression, /冻结的 Agent 开发历史/u);
  assert.doesNotMatch(expression, /historyText|config\.history/u);
  assert.doesNotMatch(expression, /aria-modal|backdropFilter|innerHTML/u);
  assert.doesNotMatch(expression, /sendFollowUpMessage|ui\/message|https?:\/\//u);
});

test("native event parser binds sequence data to one opaque trial token", () => {
  const token = "c".repeat(64);
  const payload = JSON.stringify({
    schemaVersion: 2,
    kind: "pointable.study-v2.native-event",
    trialToken: token,
    sequence: 1,
    eventType: "answer_submitted",
    monotonicMs: 123.5,
    outcomeCode: "RESUME-B",
  });
  assert.equal(parseStudyV2NativeEvent(payload, token).outcomeCode, "RESUME-B");
  assert.throws(() => parseStudyV2NativeEvent(payload, "d".repeat(64)));
  assert.throws(() => parseStudyV2NativeEvent(JSON.stringify({
    ...JSON.parse(payload) as Record<string, unknown>,
    rawSelectedText: "secret",
  }), token));
});

test("native questionnaire accepts only one complete five-rating terminal payload", () => {
  const token = "e".repeat(64);
  const submitted = parseStudyV2NativeQuestionnaireEvent(JSON.stringify({
    schemaVersion: 2,
    kind: "pointable.study-v2.native-questionnaire",
    sessionToken: token,
    sequence: 1,
    eventType: "questionnaire_submitted",
    monotonicMs: 321,
    mentalDemand: 4,
    effort: 5,
    frustration: 2,
    confidence: 6,
    informationSufficiency: 6,
  }), token);
  assert.deepEqual(questionnaireFromNativeEvent(submitted, "0123456789abcdef0123456789abcdef"), {
    schemaVersion: 2,
    sessionId: "0123456789abcdef0123456789abcdef",
    mentalDemand: 4,
    effort: 5,
    frustration: 2,
    confidence: 6,
    informationSufficiency: 6,
  });
  assert.throws(() => parseStudyV2NativeQuestionnaireEvent(JSON.stringify({
    ...submitted,
    effort: undefined,
  }), token));
  assert.throws(() => parseStudyV2NativeQuestionnaireEvent(JSON.stringify({
    ...submitted,
    rawChat: "forbidden",
  }), token));
  assert.throws(() => parseStudyV2NativeQuestionnaireEvent(JSON.stringify({
    ...submitted,
    eventType: "questionnaire_aborted",
  }), token));
});

test("native questionnaire stays inside Codex, requires trusted actions, and never sends a Chat turn", () => {
  const config = validateStudyV2NativeQuestionnaireSurfaceConfig({
    bindingName: `__pointableStudyQuestionnaireBinding_${"a".repeat(32)}`,
    sessionToken: "f".repeat(64),
    sessionId: "0123456789abcdef0123456789abcdef",
    language: "zh-CN",
    timeoutMs: 900_000,
  });
  const expression = createInstallStudyV2NativeQuestionnaireExpression(config);
  assert.match(expression, /main\[data-app-shell-main-surface\]/u);
  assert.match(expression, /event\.isTrusted/u);
  assert.match(expression, /mentalDemand/u);
  assert.match(expression, /informationSufficiency/u);
  assert.match(expression, /不发送为 Chat 消息/u);
  assert.match(expression, /继续填写研究问卷/u);
  assert.match(expression, /data-pointable-study-v2-questionnaire-resume/u);
  assert.match(expression, /textContent/u);
  assert.doesNotMatch(expression, /STUDY_V2_[A-Z_]+/u);
  assert.doesNotMatch(expression, /innerHTML|sendFollowUpMessage|ui\/message|https?:\/\//u);
});

class FakeTrialConnection implements CdpConnection {
  readonly commands: Array<{ method: string; params: Record<string, unknown> }> = [];
  #listeners = new Set<(event: CdpEvent) => void | Promise<void>>();
  #closeListeners = new Set<(error: Error) => void | Promise<void>>();
  #closed = false;
  bindingName = "";
  trialToken = "";
  trialId = "";
  activeThreadId = "thread-native-1";

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    this.commands.push({ method, params });
    if (method === "Page.getFrameTree") {
      return { frameTree: { frame: { id: "frame-1", url: "app://-/index.html" } } };
    }
    if (method === "Runtime.enable") {
      await this.emit({
        method: "Runtime.executionContextCreated",
        params: { context: { id: 77, auxData: { isDefault: true, frameId: "frame-1" } } },
      });
    }
    if (method === "Runtime.addBinding") this.bindingName = String(params.name);
    if (method === "Runtime.evaluate") {
      const expression = String(params.expression);
      if (expression.includes("data-app-action-sidebar-thread-active")) {
        const routeRef = "app://-/index.html";
        const hostId = "host-1";
        return { result: { value: {
          schemaVersion: 1,
          host: "codex-desktop",
          threadId: this.activeThreadId,
          hostId,
          routeRef,
          contextFingerprint: JSON.stringify({ href: routeRef, threadId: this.activeThreadId, hostId }),
        } } };
      }
      if (expression.includes("return value.activate()")) {
        await this.emit({
          method: "Runtime.bindingCalled",
          params: {
            name: this.bindingName,
            executionContextId: 77,
            payload: JSON.stringify({
              schemaVersion: 2,
              kind: "pointable.study-v2.native-event",
              trialToken: this.trialToken,
              sequence: 1,
              eventType: "trial_shown",
              monotonicMs: 0,
            }),
          },
        });
        return { result: { value: {
          installed: true,
          trialToken: this.trialToken,
          trialId: this.trialId,
          state: "running",
        } } };
      }
      if (expression.includes("pointableStudyV2Native")) {
        this.trialToken = /"trialToken":"([a-f0-9]{64})"/u.exec(expression)?.[1] ?? this.trialToken;
        this.trialId = /"trialId":"([A-Za-z0-9_-]+)"/u.exec(expression)?.[1] ?? this.trialId;
        return { result: { value: {
          installed: true,
          trialToken: this.trialToken,
          trialId: this.trialId,
          state: "armed",
        } } };
      }
    }
    return {};
  }

  onEvent(listener: (event: CdpEvent) => void | Promise<void>): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  onClose(listener: (error: Error) => void | Promise<void>): () => void {
    this.#closeListeners.add(listener);
    return () => this.#closeListeners.delete(listener);
  }
  isClosed(): boolean { return this.#closed; }
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const listener of this.#closeListeners) void listener(new Error("fake_transport_closed"));
  }
  async emit(event: CdpEvent): Promise<void> {
    await Promise.all([...this.#listeners].map(async (listener) => listener(event)));
  }
}

class FakeQuestionnaireConnection implements CdpConnection {
  readonly commands: Array<{ method: string; params: Record<string, unknown> }> = [];
  #listeners = new Set<(event: CdpEvent) => void | Promise<void>>();
  #closeListeners = new Set<(error: Error) => void | Promise<void>>();
  #closed = false;
  bindingName = "";
  sessionToken = "";
  sessionId = "";

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    this.commands.push({ method, params });
    if (method === "Page.getFrameTree") {
      return { frameTree: { frame: { id: "frame-1", url: "app://-/index.html" } } };
    }
    if (method === "Runtime.enable") {
      await this.emit({
        method: "Runtime.executionContextCreated",
        params: { context: { id: 88, auxData: { isDefault: true, frameId: "frame-1" } } },
      });
    }
    if (method === "Runtime.addBinding") this.bindingName = String(params.name);
    if (method === "Runtime.evaluate") {
      const expression = String(params.expression);
      if (expression.includes("return value.activate()")) {
        return { result: { value: {
          installed: true,
          sessionToken: this.sessionToken,
          sessionId: this.sessionId,
          state: "running",
        } } };
      }
      if (expression.includes("pointableStudyV2Questionnaire")) {
        this.sessionToken = /"sessionToken":"([a-f0-9]{64})"/u.exec(expression)?.[1] ?? this.sessionToken;
        this.sessionId = /"sessionId":"([a-f0-9]{32})"/u.exec(expression)?.[1] ?? this.sessionId;
        return { result: { value: {
          installed: true,
          sessionToken: this.sessionToken,
          sessionId: this.sessionId,
          state: "armed",
        } } };
      }
    }
    return {};
  }

  onEvent(listener: (event: CdpEvent) => void | Promise<void>): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  onClose(listener: (error: Error) => void | Promise<void>): () => void {
    this.#closeListeners.add(listener);
    return () => this.#closeListeners.delete(listener);
  }
  isClosed(): boolean { return this.#closed; }
  close(): void { this.#closed = true; }
  async emit(event: CdpEvent): Promise<void> {
    await Promise.all([...this.#listeners].map(async (listener) => listener(event)));
  }
}

test("native host mounts one qualified Codex target and accepts one terminal answer", async () => {
  const connection = new FakeTrialConnection();
  const observed: string[] = [];
  const host = new StudyV2NativeTrialHost({
    fetch: targetFetch(),
    connect: async () => connection,
    onEvent: (event) => { observed.push(event.eventType); },
  });
  await host.start({
    trialId: "S01-T1",
    scenarioId: "RESUME-1",
    condition: "A",
    language: "en-US",
    history: "Frozen history",
    taskPrompt: "Choose one answer",
    answers: [
      { code: "RESUME-A", label: "A" },
      { code: "RESUME-B", label: "B" },
    ],
    entityTerms: [{ term: "relay-cache public entry", objectCode: "MODULE:RELAY-CACHE-ENTRY" }],
    timeoutMs: 300_000,
  });
  assert.equal(host.status().state, "running");
  await host.activate();
  const terminalPromise = host.waitForTerminal();
  await connection.emit({
    method: "Runtime.bindingCalled",
    params: {
      name: connection.bindingName,
      executionContextId: 77,
      payload: JSON.stringify({
        schemaVersion: 2,
        kind: "pointable.study-v2.native-event",
        trialToken: connection.trialToken,
        sequence: 2,
        eventType: "answer_submitted",
        monotonicMs: 42,
        outcomeCode: "RESUME-B",
      }),
    },
  });
  assert.equal((await terminalPromise).outcomeCode, "RESUME-B");
  assert.deepEqual(observed, ["trial_shown", "answer_submitted"]);
  await host.stop("completed");
  assert.equal(connection.isClosed(), true);
  assert.equal(connection.commands.some((command) => command.method === "Runtime.removeBinding"), true);
});

test("native host can mount the non-obscuring answer-control surface", async () => {
  const connection = new FakeTrialConnection();
  connection.activeThreadId = "host-1:thread-native-1";
  const host = new StudyV2NativeTrialHost({
    fetch: targetFetch(),
    connect: async () => connection,
    surfaceMode: "answer_control",
    expectedThreadId: "thread-native-1",
  });
  await host.start({
    trialId: "S01-T1",
    scenarioId: "RESUME-1",
    condition: "A",
    language: "en-US",
    history: "Compatibility-only legacy history",
    taskPrompt: "Choose one answer",
    answers: [
      { code: "RESUME-A", label: "A" },
      { code: "RESUME-B", label: "B" },
    ],
    entityTerms: [{ term: "relay-cache public entry", objectCode: "MODULE:RELAY-CACHE-ENTRY" }],
    timeoutMs: 300_000,
  });
  assert.equal(host.status().surfaceMode, "answer_control");
  await host.activate();
  const terminalPromise = host.waitForTerminal();
  await connection.emit({
    method: "Runtime.bindingCalled",
    params: {
      name: connection.bindingName,
      executionContextId: 77,
      payload: JSON.stringify({
        schemaVersion: 2,
        kind: "pointable.study-v2.native-event",
        trialToken: connection.trialToken,
        sequence: 2,
        eventType: "answer_submitted",
        monotonicMs: 17,
        outcomeCode: "RESUME-B",
      }),
    },
  });
  assert.equal((await terminalPromise).outcomeCode, "RESUME-B");
  await host.stop("completed");
});

test("native answer-control startup cleanup preserves the task-not-active error without an unhandled close rejection", async () => {
  const connection = new FakeTrialConnection();
  connection.activeThreadId = "another-thread";
  const host = new StudyV2NativeTrialHost({
    fetch: targetFetch(),
    connect: async () => connection,
    surfaceMode: "answer_control",
    expectedThreadId: "thread-native-1",
  });

  await assert.rejects(host.start({
    trialId: "S01-T1",
    scenarioId: "RESUME-1",
    condition: "A",
    language: "en-US",
    history: "Compatibility-only legacy history",
    taskPrompt: "Choose one answer",
    answers: [
      { code: "RESUME-A", label: "A" },
      { code: "RESUME-B", label: "B" },
    ],
    entityTerms: [{ term: "relay-cache public entry", objectCode: "MODULE:RELAY-CACHE-ENTRY" }],
    timeoutMs: 300_000,
  }), /study_v2_native_task_not_active/u);

  assert.equal(host.status().state, "stopped");
  assert.equal(connection.isClosed(), true);
});

test("native questionnaire host accepts one complete terminal response and cleans up", async () => {
  const connection = new FakeQuestionnaireConnection();
  const host = new StudyV2NativeQuestionnaireHost({
    fetch: targetFetch(),
    connect: async () => connection,
  });
  await host.start({
    sessionId: "0123456789abcdef0123456789abcdef",
    language: "en-US",
    timeoutMs: 900_000,
  });
  await host.activate();
  const terminal = host.waitForTerminal();
  await connection.emit({
    method: "Runtime.bindingCalled",
    params: {
      name: connection.bindingName,
      executionContextId: 88,
      payload: JSON.stringify({
        schemaVersion: 2,
        kind: "pointable.study-v2.native-questionnaire",
        sessionToken: connection.sessionToken,
        sequence: 1,
        eventType: "questionnaire_submitted",
        monotonicMs: 500,
        mentalDemand: 4,
        effort: 5,
        frustration: 2,
        confidence: 6,
        informationSufficiency: 6,
      }),
    },
  });
  assert.equal((await terminal).eventType, "questionnaire_submitted");
  await host.stop("completed");
  assert.equal(connection.isClosed(), true);
  assert.equal(connection.commands.some((command) => command.method === "Runtime.removeBinding"), true);
});
