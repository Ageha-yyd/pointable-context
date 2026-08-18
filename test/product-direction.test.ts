import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

async function text(path: string): Promise<string> {
  return readFile(resolve(path), "utf8");
}

test("v1.2 freezes selection-triggered Quiet Mode and deterministic Artifact Context", async () => {
  const [prd, readme, mainSkill, workspaceSkill] = await Promise.all([
    text("docs/PRD-inline-pointable-widgets.md"),
    text("README.md"),
    text("skills/pointable-context/SKILL.md"),
    text("skills/pointable-context-workspace/SKILL.md"),
  ]);

  assert.match(prd, /版本：v1\.2/u);
  assert.match(prd, /默认可视入口是用户选区后的轻量按钮/u);
  assert.match(prd, /selection 本身不读取详情、不调用模型/u);
  assert.match(prd, /产品不存在“识别更多概念”模型分支/u);
  assert.match(prd, /不默认在 Agent 每段输出旁显示胶囊条/u);
  assert.match(prd, /Markdown 用途、变化章节和引用位置均来自有界本地解析\/Git，不调用模型/u);

  assert.match(readme, /primary interaction is \*\*Quiet Context Reveal\*\*/u);
  assert.match(readme, /no "identify more concepts" or semantic-model branch/u);
  assert.match(mainSkill, /Use MCP `render_context_capsule` only when the user explicitly asks/u);
  assert.match(mainSkill, /Do not offer `识别更多概念`/u);
  assert.match(workspaceSkill, /Selection alone is inert/u);
  assert.match(workspaceSkill, /There is no `识别更多概念`/u);
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
