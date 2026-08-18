import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

async function text(path: string): Promise<string> {
  return readFile(resolve(path), "utf8");
}

test("v1.7 keeps Quiet Context Reveal and adds safe scenario-specific summaries", async () => {
  const [prd, readme, mainSkill, workspaceSkill] = await Promise.all([
    text("docs/PRD-inline-pointable-widgets.md"),
    text("README.md"),
    text("skills/pointable-context/SKILL.md"),
    text("skills/pointable-context-workspace/SKILL.md"),
  ]);

  assert.match(prd, /版本：v1\.7/u);
  assert.match(prd, /默认可视入口是用户选区后的轻量按钮/u);
  assert.match(prd, /selection 本身不读取详情、不调用模型/u);
  assert.match(prd, /产品不存在“识别更多概念”模型分支/u);
  assert.match(prd, /不默认在 Agent 每段输出旁显示胶囊条/u);
  assert.match(prd, /Markdown 用途、变化章节和引用位置均来自有界本地解析\/Git，不调用模型/u);
  assert.match(prd, /Source Module 的职责、exports、diff 声明、imports 和测试\/引用位置均来自有界本地解析\/Git/u);
  assert.match(prd, /字段默认全部收起/u);
  assert.match(prd, /卡片打开时固定 `entityRevision\/observedAt\/freshness`/u);
  assert.match(prd, /可信 `刷新内容`/u);
  assert.match(prd, /最多 3 项/u);
  assert.match(prd, /私有 Host Adapter 的兼容性优先级高于继续增加对象类型/u);
  assert.match(prd, /`qualified`：四层全部通过/u);
  assert.match(prd, /启动自检只能证明可安装性，不能替代每个 build 的真实 selection/u);

  assert.match(readme, /primary interaction is \*\*Quiet Context Reveal\*\*/u);
  assert.match(readme, /no "identify more concepts" or semantic-model branch/u);
  assert.match(readme, /Only `qualified` permits the current runtime to be described as attached/u);
  assert.match(readme, /same card shows a quiet `内容已更新` notice/u);
  assert.match(readme, /Reading the file never claims PASS or FAIL/u);
  assert.match(readme, /Configuration values and potential secrets never enter the card/u);
  assert.match(mainSkill, /Use MCP `render_context_capsule` only when the user explicitly asks/u);
  assert.match(mainSkill, /Do not offer `识别更多概念`/u);
  assert.match(workspaceSkill, /Selection alone is inert/u);
  assert.match(workspaceSkill, /There is no `识别更多概念`/u);
  assert.match(workspaceSkill, /source is never executed/u);
  assert.match(workspaceSkill, /summary-first/u);
  assert.match(workspaceSkill, /trusted `刷新内容` click/u);
  assert.match(workspaceSkill, /Never translate source presence into PASS\/FAIL/u);
  assert.match(workspaceSkill, /Never expose configuration values/u);
  assert.match(workspaceSkill, /`compatibility\.state` is `qualified`/u);
});

test("plugin defaults enable Quiet Mode instead of proactively rendering capsules", async () => {
  const manifest = JSON.parse(await text(".codex-plugin/plugin.json")) as {
    interface?: { defaultPrompt?: string[]; longDescription?: string };
  };
  const prompts = manifest.interface?.defaultPrompt ?? [];

  assert.ok(prompts.length > 0);
  assert.match(prompts[0] ?? "", /Enable Pointable Context Quiet Mode/u);
  assert.ok(prompts.every((prompt) => !/^Show |^Render /u.test(prompt)));
  assert.match(manifest.interface?.longDescription ?? "", /semantic concept recognition/u);
});
