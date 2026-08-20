# Consent and withdrawal checkpoint

Before data collection, the organizer must provide the applicable study information and obtain any required institutional or ethics approval. This file is a product-flow checkpoint, not a substitute for that process.

The immutable approved release must disclose, in both study languages: the organizer contact route; the approval or documented not-required determination; recruitment dates; target completed sample; deletion-request deadline; data-freeze date; retention end date; encrypted submission repository; and that GitHub account identity is visible. Those values are bound in `pilot-governance.json`; placeholders or a candidate release are not valid consent materials.

The runner must require separate confirmations for:

1. beginning a recorded study session;
2. viewing the exact result preview;
3. encrypting and submitting the result.

Declining the third confirmation leaves the result local and creates no GitHub submission. The participant receives a random session receipt. Before the organizer's declared data-freeze date, that receipt can be used to request deletion without sending raw Chat or project data.

GitHub pull requests reveal the submitting GitHub account. Participants who require account anonymity must use a separate organizer-provided upload route.

## 中文说明

在收集数据之前，组织者必须提供适用的研究说明、数据保存与退出规则，并取得必要的机构或伦理审批。本文件只是产品流程中的检查点，不能替代正式同意程序。

不可变的正式发布包必须用中英文明确说明：组织者联系方式、审批或“不需要审批”的正式认定、招募日期、目标完成样本量、删除请求截止日期、数据冻结日期、数据保留结束日期、加密提交仓库，以及 GitHub 账号身份会被显示。上述值必须绑定在 `pilot-governance.json` 中；占位符或候选发布包不能作为有效的同意材料。

Runner 必须分别取得三次确认：开始记录试次、查看完整结果预览、加密并提交结果。拒绝第三次确认会让结果只保留在本地，不会创建 GitHub 提交。参与者会获得随机 session receipt，并可在组织者声明的数据冻结日期前用该 receipt 请求删除。

GitHub Pull Request 会显示提交账号。需要账号匿名的参与者必须使用组织者提供的其他上传路径。
