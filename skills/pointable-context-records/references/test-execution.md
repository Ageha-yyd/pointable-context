# Reliable Test Execution Events

Use this workflow only when the user explicitly asks to record one actual command execution as a durable Verification, or when an already opted-in bounded task reaches a stable verification milestone. Do not run it for every test command and do not use it to overwrite an existing record.

The runner starts one command with `shell=false`, observes the process exit, captures the Git snapshot before and after execution, and hashes the command plus stdout/stderr without persisting their raw content. A private event is stored under the local Pointable Context state directory. Only one bounded evidence line and one Verification Markdown record enter the workspace.

Create a strict request JSON in a temporary location outside the workspace:

```json
{
  "schemaVersion": 1,
  "verificationId": "stable-lowercase-id",
  "title": "Human Readable Title",
  "claim": "The bounded claim this exact command is intended to verify.",
  "gap": "What this execution still cannot prove.",
  "command": {
    "file": "ABSOLUTE_OR_PATH_EXECUTABLE",
    "args": ["ARGUMENT_1", "ARGUMENT_2"]
  },
  "timeoutMs": 120000
}
```

Resolve the Plugin root two directories above this Skill, then run:

```powershell
$skillFile = 'ABSOLUTE_PATH_TO_THIS_SKILL.md'
$pluginRoot = (Resolve-Path -LiteralPath (Join-Path (Split-Path -Parent $skillFile) '..\..')).Path
$runner = Join-Path $pluginRoot 'dist\src\records\test-execution-cli.js'
node $runner --workspace-root 'ABSOLUTE_WORKSPACE_PATH' --request-file 'ABSOLUTE_TEMP_REQUEST.json' --json
```

Interpret outcomes conservatively:

- `passed` plus no revision drift creates `PASS` for that exact command and snapshot only;
- a non-zero exit creates `FAIL` for the observed process outcome;
- timeout, cancellation, output overflow, or revision drift creates `inconclusive`, never PASS;
- command-start, workspace, Git snapshot, containment, existing-target, or Record Gate failure produces no usable Verification.

The P0 runner is create-only. Reusing an existing `verificationId` fails before starting the command, so choose a distinct stable run identity rather than silently replacing prior evidence. The generated record still requires the normal post-write Record Check. Never place credentials in command arguments, and never describe output hashes as retained raw output or proof of tests that were not executed.
