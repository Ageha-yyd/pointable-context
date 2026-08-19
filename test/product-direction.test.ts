import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

async function text(path: string): Promise<string> {
  return readFile(resolve(path), "utf8");
}

test("v2.7 freezes a non-inferential counterbalanced study pack", async () => {
  const [prd, readme, mainSkill, workspaceSkill] = await Promise.all([
    text("docs/PRD-inline-pointable-widgets.md"),
    text("README.md"),
    text("skills/pointable-context/SKILL.md"),
    text("skills/pointable-context-workspace/SKILL.md"),
  ]);

  assert.match(prd, /版本：v2\.7/u);
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
  assert.match(prd, /自动延迟基准始终标记 `technical_latency_only`/u);
  assert.match(prd, /不证明人的 `time_to_verified_fact` 已下降/u);
  assert.match(prd, /P-A\/P-B\/P-C 使用同一对象、事实与证据/u);
  assert.match(prd, /普通启动默认使用 P-C/u);
  assert.match(prd, /不证明 P-C 更快、更准确或更能减少 Chat Turn/u);
  assert.match(prd, /`docs\/concepts\/\*\.md`/u);
  assert.match(prd, /`docs\/changes\/\*\.md`/u);
  assert.match(prd, /`docs\/decisions\/\*\.md`/u);
  assert.match(prd, /`docs\/tasks\/\*\.md`/u);
  assert.match(prd, /`docs\/verifications\/\*\.md`/u);
  assert.match(prd, /普通 Chat 和测试源码仍不得自动产生完成\/PASS 结论/u);
  assert.match(prd, /一次性创建\/更新指定记录/u);
  assert.match(prd, /当前有界长任务内维护 Pointable Context 记录/u);
  assert.match(prd, /只有 `valid: true` 的集合才可视为可用索引输入/u);
  assert.match(prd, /Frozen counterbalanced study pack v1/u);
  assert.match(prd, /每个 scenario 在每个序位出现两次、在 A\/B 各出现六次/u);
  assert.match(prd, /验证器 PASS 只证明材料内部一致/u);
  assert.match(prd, /普通 prose、任意 Git diff 和隐含决策均不做语义推断/u);
  assert.match(prd, /stat\/Git\/字面关系\/evidence-source revision v2/u);
  assert.match(prd, /不建立语义依赖图/u);
  assert.match(prd, /聚焦当前 Chat composer 不关闭卡片/u);
  assert.match(prd, /后台 revision 检查不中断/u);
  assert.match(prd, /复用现有卡片 DOM/u);
  assert.match(prd, /保持当前位置、滚动位置与详情\/证据 disclosure 状态/u);
  assert.match(prd, /卡片 DOM 身份、left\/top、scrollTop/u);
  assert.match(prd, /没有显示伪造的字段差异/u);

  assert.match(readme, /primary interaction is \*\*Quiet Context Reveal\*\*/u);
  assert.match(readme, /no "identify more concepts" or semantic-model branch/u);
  assert.match(readme, /Only `qualified` permits the current runtime to be described as attached/u);
  assert.match(readme, /same card shows a quiet `内容已更新` notice/u);
  assert.match(readme, /Reading the file never claims PASS or FAIL/u);
  assert.match(readme, /Configuration values and potential secrets never enter the card/u);
  assert.match(readme, /three fixed research conditions/u);
  assert.match(readme, /mental-model.*ordinary product default/u);
  assert.match(readme, /design preference, not efficiency evidence/u);
  assert.match(readme, /before\/after\/impact/u);
  assert.match(readme, /problem\/choice\/consequence/u);
  assert.match(readme, /Agent record maintenance is opt-in/u);
  assert.match(readme, /read-only post-write gate/u);
  assert.match(readme, /Frozen study pack v1/u);
  assert.match(readme, /It has not been run and supports no efficiency claim/u);
  assert.match(readme, /bounded v2 background probe/u);
  assert.match(readme, /detects literal reference membership changes, not runtime dependencies/u);
  assert.match(readme, /keeps an open card visible when the user focuses the current Chat composer/u);
  assert.match(readme, /reuses the same card DOM in place/u);
  assert.match(mainSkill, /Use MCP `render_context_capsule` only when the user explicitly asks/u);
  assert.match(mainSkill, /Do not offer `识别更多概念`/u);
  assert.match(mainSkill, /opts the current bounded task into milestone record maintenance/u);
  assert.match(workspaceSkill, /Selection alone is inert/u);
  assert.match(workspaceSkill, /There is no `识别更多概念`/u);
  assert.match(workspaceSkill, /source is never executed/u);
  assert.match(workspaceSkill, /summary-first/u);
  assert.match(workspaceSkill, /trusted `刷新内容` click/u);
  assert.match(workspaceSkill, /Never translate source presence into PASS\/FAIL/u);
  assert.match(workspaceSkill, /Never expose configuration values/u);
  assert.match(workspaceSkill, /explicitly authored `docs\/concepts\/\*\.md` artifact/u);
  assert.match(workspaceSkill, /explicitly authored `docs\/changes\/\*\.md` artifact/u);
  assert.match(workspaceSkill, /explicitly authored `docs\/decisions\/\*\.md` artifact/u);
  assert.match(workspaceSkill, /explicitly authored `docs\/tasks\/\*\.md` record/u);
  assert.match(workspaceSkill, /always remains `未执行`/u);
  assert.match(workspaceSkill, /revision v2 as a bounded invalidation fingerprint/u);
  assert.match(workspaceSkill, /Use `mental-model` as the ordinary product default/u);
  assert.match(workspaceSkill, /Keep an open card visible when the user focuses the current Chat composer/u);
  assert.match(workspaceSkill, /reuse the same card DOM/u);
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
  assert.match(manifest.interface?.longDescription ?? "", /ordinary prose is never semantically mined/u);
});
