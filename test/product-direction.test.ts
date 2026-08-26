import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

async function text(path: string): Promise<string> {
  return readFile(resolve(path), "utf8");
}

test("v2.33 keeps large-workspace curation complete and control errors process-safe", async () => {
  const [prd, readme, mainSkill, workspaceSkill, recordsSkill, curationDecision, capacityDecision, coverage, compatibility, bundle] = await Promise.all([
    text("docs/PRD-inline-pointable-widgets.md"),
    text("README.md"),
    text("skills/pointable-context/SKILL.md"),
    text("skills/pointable-context-workspace/SKILL.md"),
    text("skills/pointable-context-records/SKILL.md"),
    text("docs/decisions/object-curation-policy.md"),
    text("docs/decisions/task-object-capacity.md"),
    text("docs/context-coverage.json"),
    text("docs/compatibility/codex-desktop-current.json"),
    readFile(resolve("host/workspace-companion.mjs")),
  ]);

  assert.match(prd, /版本：v2\.33/u);
  assert.match(prd, /`annotated_click`/u);
  assert.match(prd, /`selection_lookup`/u);
  assert.match(prd, /每条消息最多标 3 个高价值对象/u);
  assert.match(prd, /自动标注是可发现性优化，不是对象全集/u);
  assert.match(prd, /选择任意文字后在已登记对象中做确定性匹配/u);
  assert.match(prd, /P0 不提供 LLM 语义扩展/u);
  assert.match(prd, /selection 本身不读取 Context Index、不调用 Provider、不调用模型/u);
  assert.match(prd, /不支持 CSS Custom Highlight 的宿主必须无损降级为选区入口/u);
  assert.match(prd, /默认体验必须发生在当前 Codex Desktop 任务中/u);
  assert.match(prd, /不得创建 Chat Turn/u);
  assert.match(prd, /稳定身份、来源、修订、观察时间和 freshness/u);
  assert.match(prd, /Task 最高，其次 Decision、Change、Verification、Concept/u);
  assert.match(prd, /Task-local Dynamic Object Lifecycle/u);
  assert.match(prd, /身份改变必须一次性 `supersede`/u);
  assert.match(prd, /`freshness=partial`/u);
  assert.match(prd, /登记只刷新 identity catalog，不读取详情或创建 Chat Turn/u);
  assert.match(prd, /稳定里程碑触发的两级路由/u);
  assert.match(prd, /单个稳定里程碑通常最多新增一个 task-local 对象/u);
  assert.match(prd, /只有稳定制品通过适用 checker 后才退役对应临时对象/u);
  assert.match(prd, /达到 64 个 active 对象时给出软警告但不阻断有效写入/u);
  assert.match(prd, /256 个 active 仍然硬性 fail closed/u);
  assert.match(prd, /active、无匹配或歧义记录绝不归档/u);
  assert.match(prd, /Archive 不参与 lookup authority/u);
  assert.match(prd, /绝不跨任务、route、scope 或 workspace 迁移/u);
  assert.match(prd, /显式固定的临时阅读面板/u);
  assert.match(prd, /每个具备唯一 term 的对象一个主入口/u);
  assert.match(prd, /Explicit Milestone Object Review/u);
  assert.match(prd, /不得扫描 Chat、读取详情、自动补对象/u);
  assert.match(prd, /人工十项 pending/u);
  assert.match(prd, /功能冻结后再为一个 Release Candidate 执行完整十项原生人工门禁/u);
  assert.match(prd, /Reliable Test Execution Event/u);
  assert.match(prd, /timeout\/cancel\/output overflow\/revision drift/u);
  assert.match(prd, /Private Multi-milestone Observation Ledger/u);
  assert.match(prd, /Ephemeral Milestone Curation Feedback/u);
  assert.match(prd, /只有同状态再次出现的 `recurring_gap` 给 `review_registration`/u);
  assert.match(prd, /历史缺口不能让恢复永久粘住/u);
  assert.match(prd, /禁止 raw term\/milestone、Chat、事实、文件内容、路径和任务标识/u);
  assert.match(prd, /超过 512 事件或 4 MiB 均 fail closed/u);
  assert.match(prd, /不证明用户理解、时间缩短、Chat Turn 减少或统计显著性/u);
  assert.match(prd, /Large Workspace Development Surface and Crash-safe Control/u);
  assert.match(prd, /默认最多发现 20,000 个候选文件/u);
  assert.match(prd, /保持 companion 存活/u);
  assert.match(prd, /四个噪声里程碑 0 个误建对象/u);
  assert.match(prd, /三个明确需要的对象 3\/3 available/u);
  assert.match(prd, /升级为有证据的稳定 Task/u);

  assert.match(readme, /bounded identity-only catalog/u);
  assert.match(readme, /Any registered object omitted by that Top-3 remains reachable/u);
  assert.match(readme, /no model call is made/u);
  assert.match(readme, /no follow-up turn is created/u);
  assert.match(readme, /current Codex Chat Lane/u);
  assert.match(readme, /private task-object registry/u);
  assert.match(readme, /Superseded and retired keys remain terminal/u);
  assert.match(readme, /non-blocking curation warning at 64 active current-task objects/u);
  assert.match(readme, /Active, unmatched, and ambiguous records are never archived/u);
  assert.match(readme, /Records are never adopted across another task, route, scope, or workspace/u);
  assert.match(readme, /one primary annotation term per unambiguous object before aliases/u);
  assert.match(
    readme,
    /current v2\.33 bundle.*passed automatic Host gates 4\/4.*all ten manual interaction gates remain pending/u,
  );
  assert.match(readme, /complete development-context surface/u);
  assert.match(readme, /malformed milestone review returns an error without killing the detached companion/u);
  assert.match(readme, /newly created Codex task.*without inheriting private task-local state/u);
  assert.match(readme, /Recovery Observation Prototype.*prototype-only.*not human-efficiency evidence/u);
  assert.match(readme, /object-review --review-file/u);
  assert.match(readme, /available, missing, ambiguous, and type-mismatch/u);
  assert.match(readme, /Private multi-milestone observation/u);
  assert.match(readme, /milestone-observe --review-file/u);
  assert.match(readme, /never stores raw terms, milestone names, Chat, Provider facts, file content, workspace paths, or Codex task\/thread identifiers/u);
  assert.match(readme, /fails closed at 512 events or 4 MiB/u);
  assert.match(readme, /ephemeral response \(`persisted=false`\)/u);
  assert.match(readme, /Only a recurring gap may return `review_registration`/u);
  assert.match(readme, /immediately previous observation/u);

  assert.match(mainSkill, /two zero-turn entries/u);
  assert.match(mainSkill, /Any registered object not marked remains reachable/u);
  assert.match(mainSkill, /Do not offer LLM semantic expansion/u);
  assert.match(mainSkill, /mark at most three non-overlapping objects/u);
  assert.match(workspaceSkill, /Selection alone is inert/u);
  assert.match(workspaceSkill, /There is no `识别更多概念`/u);
  assert.match(workspaceSkill, /Task-local dynamic Object lifecycle/u);
  assert.match(workspaceSkill, /object-supersede/u);
  assert.match(workspaceSkill, /freshness=partial/u);
  assert.match(workspaceSkill, /normally introduce no more than one new task-local object per milestone/u);
  assert.match(workspaceSkill, /A valid stable artifact wins/u);
  assert.match(workspaceSkill, /active_soft_limit_reached/u);
  assert.match(workspaceSkill, /object-archive --json/u);
  assert.match(workspaceSkill, /object-audit --json/u);
  assert.match(workspaceSkill, /object-review --review-file/u);
  assert.match(workspaceSkill, /It must not read Provider detail, persist the review, infer undeclared needs/u);
  assert.match(workspaceSkill, /milestone-observe --review-file/u);
  assert.match(workspaceSkill, /must not store raw terms, milestone names, Chat, Provider facts, file content, workspace paths, or task\/thread IDs/u);
  assert.match(workspaceSkill, /milestone-summary --json/u);
  assert.match(workspaceSkill, /measurement=ephemeral_current_review_feedback/u);
  assert.match(workspaceSkill, /historical gaps must not make recovery sticky/u);
  assert.match(workspaceSkill, /JSON token for an understanding need is exactly `"understand"`/u);
  assert.match(workspaceSkill, /another task\/workspace context starts with no inherited feedback history/u);
  assert.match(workspaceSkill, /Active, unmatched, and ambiguous records never archive/u);
  assert.match(workspaceSkill, /must never migrate objects across another task, route, scope, or workspace/u);
  assert.match(workspaceSkill, /moved card is explicitly pinned/u);
  assert.match(workspaceSkill, /reserve one highest-priority unambiguous primary term/u);
  assert.match(recordsSkill, /Normally create no more than one explanatory artifact/u);
  assert.match(recordsSkill, /Two-tier object curation/u);
  assert.match(recordsSkill, /Retire the corresponding task-local object only after the stable artifact reports `valid: true`/u);
  assert.match(recordsSkill, /Archive is maintenance, not graduation evidence/u);
  assert.match(recordsSkill, /workspace companion's `object-review`/u);
  assert.match(recordsSkill, /`milestone-observe` may persist the review only as a private digest\/status\/type\/source\/count event/u);
  assert.match(recordsSkill, /references\/test-execution\.md/u);
  assert.match(curationDecision, /Agent 在明确授权的有界任务中只于稳定里程碑维护对象/u);
  assert.match(capacityDecision, /热 Registry 在每个当前任务达到 64 个 active 对象时给出软警告/u);
  assert.match(capacityDecision, /Archive 不参与查询/u);
  assert.match(coverage, /"id": "object-curation-policy"/u);
  assert.match(coverage, /"id": "task-object-capacity"/u);
  assert.match(coverage, /"id": "test-execution-runner"/u);
  assert.match(coverage, /"id": "milestone-observation-ledger"/u);
  assert.match(coverage, /"id": "vite-pr22642-object-lifecycle-replay"/u);
  assert.match(coverage, /"id": "long-task-recovery-dogfood-task"/u);

  const current = JSON.parse(compatibility) as {
    implementation?: { productVersion?: string; rendererBundleSha256?: string };
    automatic?: { state?: string };
    manualChecks?: Array<{ result?: string }>;
  };
  assert.equal(current.implementation?.productVersion, "v2.33");
  assert.equal(
    current.implementation?.rendererBundleSha256,
    createHash("sha256").update(bundle).digest("hex"),
  );
  assert.equal(current.automatic?.state, "qualified");
  assert.equal(current.manualChecks?.length, 10);
  assert.ok(current.manualChecks?.every((check) => check.result === "pending"));
});

test("plugin defaults enable Quiet Mode instead of proactively rendering capsules", async () => {
  const manifest = JSON.parse(await text(".codex-plugin/plugin.json")) as {
    interface?: { defaultPrompt?: string[]; longDescription?: string };
  };
  const prompts = manifest.interface?.defaultPrompt ?? [];

  assert.ok(prompts.length > 0);
  assert.match(prompts[0] ?? "", /Enable Pointable Context Quiet Mode/u);
  assert.ok(prompts.every((prompt) => !/^Show |^Render /u.test(prompt)));
  assert.match(manifest.interface?.longDescription ?? "", /ordinary prose is never semantically mined/u);
});

test("study-v2 release command builds the bundle before invoking the release builder", async () => {
  const packageJson = JSON.parse(await text("package.json")) as { scripts?: Record<string, string> };
  assert.match(packageJson.scripts?.["build:study-v2"] ?? "", /build:study-v2:bundle/u);
  assert.match(packageJson.scripts?.["build:study-v2"] ?? "", /scripts\/build-study-v2-release\.mjs/u);
});
