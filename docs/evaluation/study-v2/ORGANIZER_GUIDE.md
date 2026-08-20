# Organizer guide / 实验组织者指南

## Before recruitment / 招募前

1. Freeze one commit from `experiment/study-v2-bilingual`; do not recruit from a moving branch head.
2. Run the complete repository suite, study pack validation, plugin validation, and a clean Windows rehearsal from the generated ZIP.
3. Record the qualified Codex Desktop package, renderer digest, study pack digest, release SHA-256, and runner version.
4. Obtain the applicable ethics, consent, privacy, and data-retention approvals.
5. Prepare a separate submissions repository that accepts encrypted `.pcstudy` files only.
6. Copy `PILOT_GOVERNANCE_TEMPLATE.json` outside the participant pack, replace every pending value, and validate it against the exact frozen commit and organizer RSA public key.

## Assignment / 分配

Assign each participant before observing performance:

- participant code: `P001`–`P999`, pseudonymous and unique;
- slot: integer `1`–`12`, following the counterbalanced schedule;
- language: `zh-CN` or `en-US`, chosen by the participant before TRAIN-1;
- immutable release commit and ZIP digest.

Do not let participants or their Setup Agent select a slot. Language may reflect participant preference, but it becomes immutable once the session checkpoint is created.

## Participant handoff / 发给参与者的内容

Provide exactly:

- repository URL and frozen branch/tag or Release URL;
- participant code and slot through a private channel;
- organizer public encryption key;
- submissions repository or a non-GitHub return route;
- contact path for procedural questions;
- consent and withdrawal information.

Never provide answer keys, scenario order explanations, a shared GitHub token, or a pre-opened measured transcript.

## Governance gate / 治理门禁

The normal release build is deliberately non-recruiting. Validate the completed governance record first:

```powershell
node study-dist/pointable-study.mjs validate-governance `
  --governance <absolute-governance.json> `
  --public-key <absolute-organizer-public.pem> `
  --release-commit <40-hex-frozen-commit> --json
```

Only a `valid: true` result may be passed to the release builder with `--governance` and `--public-key`. The repository must also be clean, and `releaseTag` must already be an annotated tag resolving to the governed commit. The resulting `release-manifest.json` must say exactly `approved_for_pilot_data_collection`; candidate, prototype, missing, or unknown status must stop setup before a measured trial.

普通构建默认只能生成不可招募的候选包。只有治理文件与实际公钥、冻结 commit 校验一致后，才允许构建正式 pilot 包。任何候选、原型、缺失或未知状态都必须在计分试次前停止。

## Session supervision / 实验期间

- Help only with setup and procedure, not scenario meaning or the correct object.
- Record stable setup error codes, not screenshots containing ordinary user data.
- If Host qualification, pack digest, language checkpoint, or task restoration fails, stop and reschedule; do not improvise a browser fallback.
- After the sixth answer, verify that the retained review task still opens before the questionnaire is submitted and remains recoverable afterward.
- Require participant review and explicit confirmation before encryption or submission.

## Controlled runner commands / 受控运行命令

Run these only after TRAIN-1 and `STUDY READY`. Replace the assigned values; do not generate a slot automatically.

```powershell
$experimentRoot = (Get-Location).Path
$participantCode = "P014"
$slot = 4
$language = "zh-CN" # or en-US, fixed before TRAIN-1
$sessionId = node.exe -e "process.stdout.write(require('node:crypto').randomBytes(16).toString('hex'))"
$sessionRoot = Join-Path $env:LOCALAPPDATA "PointableContextStudy\v2\$sessionId"
$stateDir = Join-Path $sessionRoot "state"
$resultDir = Join-Path $sessionRoot "result"
New-Item -ItemType Directory -Force -Path $sessionRoot | Out-Null

node.exe study-dist/pointable-study.mjs run-native-session `
  --repository-root $experimentRoot --state-dir $stateDir --result-dir $resultDir `
  --participant-code $participantCode --session-id $sessionId --slot $slot `
  --language $language --json

node.exe study-dist/pointable-study.mjs finalize-native-session `
  --repository-root $experimentRoot --state-dir $stateDir --result-dir $resultDir `
  --participant-code $participantCode --session-id $sessionId --slot $slot `
  --language $language --json
```

The first command checkpoints six trials and returns `awaiting_questionnaire`. The second resumes the same immutable session, collects the five ratings inside Codex, validates the result directory, and writes the completion receipt. If the process stops, rerun the same command with the same code, slot, language, session ID, and directories; a different value must be rejected as `study_v2_checkpoint_context_mismatch`.

For a packaged Release, replace `study-dist/pointable-study.mjs` with `bin/pointable-study.mjs`.

## Collection and analysis / 收集与分析

Validate each encrypted envelope receipt and keep GitHub identity separate from decrypted study data. Primary analysis should compare within-participant A/B differences in `task_completion_ms` and `success`; report medians, uncertainty intervals, order effects, language subgroup descriptives, and exclusions decided before unblinding. Do not infer real-model Chat-turn reduction from this no-model study alone.
