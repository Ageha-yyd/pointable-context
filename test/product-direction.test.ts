import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

async function text(path: string): Promise<string> {
  return readFile(resolve(path), "utf8");
}

test("v2.23 freezes dual zero-turn interaction plus two-tier object curation", async () => {
  const [prd, readme, mainSkill, workspaceSkill, recordsSkill, curationDecision, coverage] = await Promise.all([
    text("docs/PRD-inline-pointable-widgets.md"),
    text("README.md"),
    text("skills/pointable-context/SKILL.md"),
    text("skills/pointable-context-workspace/SKILL.md"),
    text("skills/pointable-context-records/SKILL.md"),
    text("docs/decisions/object-curation-policy.md"),
    text("docs/context-coverage.json"),
  ]);

  assert.match(prd, /版本：v2\.23/u);
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

  assert.match(readme, /bounded identity-only catalog/u);
  assert.match(readme, /Any registered object omitted by that Top-3 remains reachable/u);
  assert.match(readme, /no model call is made/u);
  assert.match(readme, /no follow-up turn is created/u);
  assert.match(readme, /current Codex Chat Lane/u);
  assert.match(readme, /private task-object registry/u);
  assert.match(readme, /Superseded and retired keys remain terminal/u);

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
  assert.match(recordsSkill, /Normally create no more than one explanatory artifact/u);
  assert.match(recordsSkill, /Two-tier object curation/u);
  assert.match(recordsSkill, /Retire the corresponding task-local object only after the stable artifact reports `valid: true`/u);
  assert.match(curationDecision, /Agent 在明确授权的有界任务中只于稳定里程碑维护对象/u);
  assert.match(coverage, /"id": "object-curation-policy"/u);
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
