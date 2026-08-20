# Encrypted GitHub submission flow

Distribution and collection use separate repositories:

- the product repository and immutable GitHub Release distribute the study package;
- a dedicated submissions repository accepts only encrypted `.pcstudy` envelopes and digest receipts.

The participant uses their own GitHub authentication. Never distribute a shared personal access token and never grant participants direct write access to the product repository.

The local sequence is:

```text
validate-result -> preview-result -> explicit confirmation -> pack-result -> submit
```

`pack-result` validates all five result files, encrypts them with AES-256-GCM, and wraps the random content key using the organizer's RSA-OAEP-SHA256 public key. The plaintext session identifier and participant code are inside the ciphertext.

The submission workflow may check filename shape, maximum size, envelope type, and SHA-256. It must not decrypt, check out, import, install, or execute pull-request content and must not expose repository secrets to participant-controlled code.

The GitHub PR identity is visible even though the payload is encrypted. This route is pseudonymous at the data-content layer, not anonymous at the account layer.

## Participant commands / 参与者命令

After reviewing the preview and explicitly confirming submission:

```powershell
node study-dist/pointable-study.mjs validate-result --result-dir <result-dir> --json
node study-dist/pointable-study.mjs preview-result --result-dir <result-dir> --json
node study-dist/pointable-study.mjs pack-result --result-dir <result-dir> --public-key <organizer-public.pem> --output <new-result.pcstudy> --json
node study-dist/pointable-study.mjs submit --github --envelope <new-result.pcstudy> --repository <owner/submissions-repo> --base main --dry-run --json
node study-dist/pointable-study.mjs submit --github --envelope <new-result.pcstudy> --repository <owner/submissions-repo> --base main --confirm-submit --json
```

For a packaged Release, use `bin/pointable-study.mjs`. The dry run must succeed before confirmation. Only the encrypted envelope and digest receipt may enter the submission PR; never commit the local result directory.

中文：参与者必须先查看 preview，再明确确认加密与提交。第一次 `submit` 必须使用 `--dry-run`；确认路径、仓库和文件摘要正确后，才运行 `--confirm-submit`。GitHub 返回路径是内容加密的假名化收集，不是账号匿名收集。
