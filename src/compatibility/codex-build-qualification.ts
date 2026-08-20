import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

const DEFAULT_RECORD_PATH = "docs/compatibility/codex-desktop-current.json";
const MAX_RECORD_BYTES = 128 * 1024;
const MAX_RENDERER_BUNDLE_BYTES = 2 * 1024 * 1024;

export const CODEX_MANUAL_COMPATIBILITY_CHECKS = Object.freeze([
  "selection_inert",
  "trusted_click",
  "anchored_card",
  "progressive_disclosure",
  "close_and_focus_restore",
  "composer_persistence",
  "scroll_and_virtualization",
  "navigation_recovery",
  "stale_response_cleanup",
  "refresh_continuity",
] as const);

export type CodexManualCompatibilityCheck =
  (typeof CODEX_MANUAL_COMPATIBILITY_CHECKS)[number];
export type CodexCompatibilityQualification =
  | "qualified"
  | "manual_pending"
  | "manual_failed"
  | "automatic_failed"
  | "environment_mismatch"
  | "invalid";

interface ManualCheckRecord {
  id: CodexManualCompatibilityCheck;
  result: "pass" | "fail" | "pending";
  observedAt?: string;
  evidenceSource?: string;
  evidenceExcerpt?: string;
}

interface CodexCompatibilityRecord {
  schemaVersion: 1;
  contract: "private-codex-chat-lane-v1";
  host: {
    packageName: "OpenAI.Codex";
    packageVersion: string;
    executableVersion: string;
    architecture: string;
    capturedAt: string;
  };
  implementation: {
    productVersion: string;
    rendererBundleSha256: string;
  };
  automatic: {
    checkedAt: string;
    state: "qualified" | "unavailable" | "incompatible" | "unchecked";
    code: string;
    gates: {
      exactMainTarget: "pass" | "fail" | "unavailable";
      mainFrame: "pass" | "fail" | "unavailable";
      mainExecutionContext: "pass" | "fail" | "unavailable";
      rendererLifecycle: "pass" | "fail" | "unavailable";
    };
  };
  manualChecks: readonly ManualCheckRecord[];
}

export type CodexCompatibilityIssueCode =
  | "workspace_unavailable"
  | "record_unavailable"
  | "record_invalid"
  | "host_build_mismatch"
  | "bundle_unavailable"
  | "bundle_digest_mismatch"
  | "automatic_not_qualified"
  | "manual_pending"
  | "manual_failed"
  | "manual_evidence_invalid";

export interface CodexCompatibilityIssue {
  code: CodexCompatibilityIssueCode;
  checkId?: CodexManualCompatibilityCheck;
}

export interface CodexCompatibilityQualificationResult {
  schemaVersion: 1;
  valid: boolean;
  qualification: CodexCompatibilityQualification;
  checkedAt: string;
  recordPath?: string;
  contract?: string;
  hostPackageVersion?: string;
  executableVersion?: string;
  productVersion?: string;
  automaticQualified: boolean;
  manual: {
    passed: number;
    failed: number;
    pending: number;
    total: number;
  };
  issues: readonly CodexCompatibilityIssue[];
}

export interface AuditCodexCompatibilityOptions {
  recordPath?: string;
  rendererBundlePath?: string;
  expectedHostPackageVersion?: string;
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  if (Reflect.ownKeys(value).some((key) => typeof key !== "string")) return false;
  return Object.keys(value).sort().join("|") === [...keys].sort().join("|");
}

function boundedText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max &&
    !/[\p{Cc}\p{Cf}]/u.test(value);
}

function timestamp(value: unknown): value is string {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value) &&
    Number.isFinite(Date.parse(value));
}

function portablePath(value: unknown): value is string {
  return boundedText(value, 512) && !value.includes("\\") && !value.startsWith("/") &&
    value.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

function portableRelative(root: string, target: string): string | undefined {
  const value = relative(root, target);
  if (value === "" || value === ".." || value.startsWith(`..${sep}`) || isAbsolute(value)) {
    return undefined;
  }
  return value.split(sep).join("/");
}

function parseManualCheck(value: unknown): ManualCheckRecord | undefined {
  if (!plainObject(value)) return undefined;
  const id = value.id;
  if (!CODEX_MANUAL_COMPATIBILITY_CHECKS.includes(id as CodexManualCompatibilityCheck)) {
    return undefined;
  }
  if (value.result === "pending") {
    if (!exactKeys(value, ["id", "result"])) return undefined;
    return Object.freeze({ id: id as CodexManualCompatibilityCheck, result: "pending" });
  }
  if (
    (value.result !== "pass" && value.result !== "fail") ||
    !exactKeys(value, ["id", "result", "observedAt", "evidenceSource", "evidenceExcerpt"]) ||
    !timestamp(value.observedAt) ||
    !boundedText(value.evidenceSource, 600) ||
    !boundedText(value.evidenceExcerpt, 1_024)
  ) {
    return undefined;
  }
  return Object.freeze({
    id: id as CodexManualCompatibilityCheck,
    result: value.result,
    observedAt: value.observedAt,
    evidenceSource: value.evidenceSource,
    evidenceExcerpt: value.evidenceExcerpt,
  });
}

function parseRecord(value: unknown): CodexCompatibilityRecord | undefined {
  if (
    !plainObject(value) ||
    !exactKeys(value, ["schemaVersion", "contract", "host", "implementation", "automatic", "manualChecks"]) ||
    value.schemaVersion !== 1 ||
    value.contract !== "private-codex-chat-lane-v1" ||
    !plainObject(value.host) ||
    !exactKeys(value.host, ["packageName", "packageVersion", "executableVersion", "architecture", "capturedAt"]) ||
    value.host.packageName !== "OpenAI.Codex" ||
    !boundedText(value.host.packageVersion, 64) ||
    !boundedText(value.host.executableVersion, 64) ||
    !boundedText(value.host.architecture, 32) ||
    !timestamp(value.host.capturedAt) ||
    !plainObject(value.implementation) ||
    !exactKeys(value.implementation, ["productVersion", "rendererBundleSha256"]) ||
    !boundedText(value.implementation.productVersion, 64) ||
    typeof value.implementation.rendererBundleSha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(value.implementation.rendererBundleSha256) ||
    !plainObject(value.automatic) ||
    !exactKeys(value.automatic, ["checkedAt", "state", "code", "gates"]) ||
    !timestamp(value.automatic.checkedAt) ||
    !["qualified", "unavailable", "incompatible", "unchecked"].includes(value.automatic.state as string) ||
    !boundedText(value.automatic.code, 128) ||
    !plainObject(value.automatic.gates) ||
    !exactKeys(value.automatic.gates, ["exactMainTarget", "mainFrame", "mainExecutionContext", "rendererLifecycle"]) ||
    !Array.isArray(value.manualChecks) ||
    value.manualChecks.length !== CODEX_MANUAL_COMPATIBILITY_CHECKS.length
  ) {
    return undefined;
  }
  const gateValues = Object.values(value.automatic.gates);
  if (gateValues.some((gate) => gate !== "pass" && gate !== "fail" && gate !== "unavailable")) {
    return undefined;
  }
  const manualChecks = value.manualChecks.map(parseManualCheck);
  if (manualChecks.some((check) => check === undefined)) return undefined;
  const ids = new Set(manualChecks.map((check) => check?.id));
  if (ids.size !== CODEX_MANUAL_COMPATIBILITY_CHECKS.length ||
      CODEX_MANUAL_COMPATIBILITY_CHECKS.some((id) => !ids.has(id))) {
    return undefined;
  }
  return Object.freeze({
    schemaVersion: 1,
    contract: "private-codex-chat-lane-v1",
    host: Object.freeze({ ...value.host }) as CodexCompatibilityRecord["host"],
    implementation: Object.freeze({ ...value.implementation }) as CodexCompatibilityRecord["implementation"],
    automatic: Object.freeze({
      ...value.automatic,
      gates: Object.freeze({ ...value.automatic.gates }),
    }) as CodexCompatibilityRecord["automatic"],
    manualChecks: Object.freeze(manualChecks as ManualCheckRecord[]),
  });
}

async function readBoundedJson(path: string): Promise<unknown> {
  const info = await stat(path);
  if (!info.isFile() || info.size < 2 || info.size > MAX_RECORD_BYTES) throw new Error("record_invalid");
  return JSON.parse(await readFile(path, "utf8"));
}

async function exactEvidence(root: string, check: ManualCheckRecord): Promise<boolean> {
  if (check.result === "pending") return true;
  const source = check.evidenceSource ?? "";
  const match = /^(.*):(\d+)$/u.exec(source);
  const evidencePath = match?.[1];
  const evidenceLine = match?.[2];
  if (!portablePath(evidencePath) || evidenceLine === undefined) return false;
  const candidate = resolve(root, evidencePath);
  let canonical: string;
  try {
    canonical = await realpath(candidate);
  } catch {
    return false;
  }
  if (portableRelative(root, canonical) === undefined) return false;
  const lines = (await readFile(canonical, "utf8")).split(/\r?\n/u);
  const line = Number.parseInt(evidenceLine, 10);
  return Number.isSafeInteger(line) && line >= 1 && lines[line - 1] === check.evidenceExcerpt;
}

function emptyResult(checkedAt: string, code: CodexCompatibilityIssueCode): CodexCompatibilityQualificationResult {
  return Object.freeze({
    schemaVersion: 1,
    valid: false,
    qualification: "invalid",
    checkedAt,
    automaticQualified: false,
    manual: Object.freeze({ passed: 0, failed: 0, pending: 0, total: 0 }),
    issues: Object.freeze([{ code }]),
  });
}

export async function auditCodexBuildQualification(
  workspaceRoot: string,
  options: AuditCodexCompatibilityOptions = {},
): Promise<CodexCompatibilityQualificationResult> {
  const checkedAt = new Date().toISOString();
  let root: string;
  try {
    root = await realpath(resolve(workspaceRoot));
  } catch {
    return emptyResult(checkedAt, "workspace_unavailable");
  }
  const recordPath = options.recordPath ?? DEFAULT_RECORD_PATH;
  if (!portablePath(recordPath)) return emptyResult(checkedAt, "record_invalid");
  const absoluteRecord = resolve(root, recordPath);
  if (portableRelative(root, absoluteRecord) === undefined) return emptyResult(checkedAt, "record_invalid");
  let record: CodexCompatibilityRecord | undefined;
  try {
    const canonicalRecord = await realpath(absoluteRecord);
    if (portableRelative(root, canonicalRecord) === undefined) return emptyResult(checkedAt, "record_invalid");
    record = parseRecord(await readBoundedJson(canonicalRecord));
  } catch {
    return emptyResult(checkedAt, "record_unavailable");
  }
  if (record === undefined) return emptyResult(checkedAt, "record_invalid");

  const issues: CodexCompatibilityIssue[] = [];
  if (options.expectedHostPackageVersion !== undefined &&
      record.host.packageVersion !== options.expectedHostPackageVersion) {
    issues.push({ code: "host_build_mismatch" });
  }
  if (options.rendererBundlePath !== undefined) {
    if (!portablePath(options.rendererBundlePath)) {
      issues.push({ code: "bundle_unavailable" });
    } else {
      try {
        const bundle = await realpath(resolve(root, options.rendererBundlePath));
        if (portableRelative(root, bundle) === undefined) throw new Error("outside");
        const info = await stat(bundle);
        if (!info.isFile() || info.size < 1 || info.size > MAX_RENDERER_BUNDLE_BYTES) {
          throw new Error("bundle_size");
        }
        const digest = createHash("sha256").update(await readFile(bundle)).digest("hex");
        if (digest !== record.implementation.rendererBundleSha256) {
          issues.push({ code: "bundle_digest_mismatch" });
        }
      } catch {
        issues.push({ code: "bundle_unavailable" });
      }
    }
  }

  const automaticQualified = record.automatic.state === "qualified" &&
    Object.values(record.automatic.gates).every((gate) => gate === "pass");
  if (!automaticQualified) issues.push({ code: "automatic_not_qualified" });

  let passed = 0;
  let failed = 0;
  let pending = 0;
  for (const check of record.manualChecks) {
    if (check.result === "pending") {
      pending += 1;
      continue;
    }
    if (!(await exactEvidence(root, check))) {
      issues.push({ code: "manual_evidence_invalid", checkId: check.id });
      failed += 1;
      continue;
    }
    if (check.result === "pass") passed += 1;
    else failed += 1;
  }
  if (failed > 0) issues.push({ code: "manual_failed" });
  else if (pending > 0) issues.push({ code: "manual_pending" });

  const mismatch = issues.some((issue) =>
    issue.code === "host_build_mismatch" || issue.code === "bundle_unavailable" ||
    issue.code === "bundle_digest_mismatch");
  const qualification: CodexCompatibilityQualification = mismatch
    ? "environment_mismatch"
    : !automaticQualified
      ? "automatic_failed"
      : failed > 0
        ? "manual_failed"
        : pending > 0
          ? "manual_pending"
          : "qualified";
  return Object.freeze({
    schemaVersion: 1,
    valid: !issues.some((issue) => issue.code === "manual_evidence_invalid"),
    qualification,
    checkedAt,
    recordPath,
    contract: record.contract,
    hostPackageVersion: record.host.packageVersion,
    executableVersion: record.host.executableVersion,
    productVersion: record.implementation.productVersion,
    automaticQualified,
    manual: Object.freeze({ passed, failed, pending, total: record.manualChecks.length }),
    issues: Object.freeze(issues.map((issue) => Object.freeze({ ...issue }))),
  });
}
