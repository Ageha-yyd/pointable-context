import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type {
  AuthorityResult,
  AuthoritativeProvider,
  ContextBindingPort,
  ContextBindingResult,
  ContextIndexPort,
  ContextScopeRef,
  DetailSnapshot,
  HostContext,
  IdentityRecord,
  TrustedContextBinding,
} from "../contracts.js";
import {
  copyContextScope,
  sameContextScope,
} from "../context-scope.js";
import {
  ContractError,
  parseContextIndexRecords,
  parseDetailSnapshot,
} from "../validation.js";

export interface ProjectManifest {
  schemaVersion: "1.0";
  projectId: string;
  bindingRevision: string;
}

export const FIXTURE_PROJECT_NAMESPACE = "fixture-json-v1";

export function fixtureProjectScope(projectId: string): ContextScopeRef {
  return {
    kind: "project",
    namespace: FIXTURE_PROJECT_NAMESPACE,
    id: projectId,
  };
}

export function fixtureProjectId(scope: ContextScopeRef): string {
  if (
    scope.kind !== "project" ||
    scope.namespace !== FIXTURE_PROJECT_NAMESPACE
  ) {
    throw new ContractError("fixture JSON requires its bound project scope");
  }
  return scope.id;
}

function asObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ContractError(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ContractError(`${path} must be a non-empty string`);
  }
  return value;
}

const MAX_JSON_BYTES = 5 * 1024 * 1024;

async function loadJson(path: string): Promise<unknown> {
  const file = await stat(path);
  if (!file.isFile()) {
    throw new ContractError("JSON input must be a regular file");
  }
  if (file.size > MAX_JSON_BYTES) {
    throw new ContractError(`JSON input exceeds ${MAX_JSON_BYTES} bytes`);
  }
  const text = await readFile(path, "utf8");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ContractError("JSON input is malformed");
  }
}

export async function loadProjectManifest(path: string): Promise<ProjectManifest> {
  const raw = asObject(await loadJson(path), "project_context");
  const schemaVersion = asString(raw.schema_version, "project_context.schema_version");
  if (schemaVersion !== "1.0") {
    throw new ContractError("project_context.schema_version must be 1.0");
  }
  return {
    schemaVersion,
    projectId: asString(raw.project_id, "project_context.project_id"),
    bindingRevision: asString(
      raw.binding_revision,
      "project_context.binding_revision",
    ),
  };
}

function normalizedPath(path: string): string {
  return process.platform === "win32" ? path.toLocaleLowerCase("en-US") : path;
}

function pathsEqual(left: string, right: string): boolean {
  return normalizedPath(left) === normalizedPath(right);
}

function isDescendant(root: string, target: string): boolean {
  const child = relative(root, target);
  return (
    child.length > 0 &&
    child !== ".." &&
    !child.startsWith(`..${sep}`) &&
    !isAbsolute(child)
  );
}

async function canonicalDataPath(
  path: string,
  binding: TrustedContextBinding,
): Promise<string> {
  if (!binding.workspaceRoot) {
    throw new ContractError("fixture data requires a canonical workspace root");
  }
  const [canonicalRoot, canonicalFile] = await Promise.all([
    realpath(binding.workspaceRoot),
    realpath(path),
  ]);
  if (!isDescendant(canonicalRoot, canonicalFile)) {
    throw new ContractError("fixture data must remain inside the bound workspace root");
  }
  return canonicalFile;
}

interface FileBindingState {
  manifest: ProjectManifest;
  canonicalRoot: string;
}

/**
 * Development/fixture-only project binding.
 *
 * A production host adapter must obtain project/thread/route state from the
 * host's live authority. This adapter deliberately trusts only an explicitly
 * selected project plus a pinned, canonical workspace root and a manifest that
 * is re-read for every resolve/revalidate operation.
 */
export class FixtureFileProjectBinding implements ContextBindingPort {
  readonly manifestPath: string;
  readonly workspaceRoot: string;

  constructor(manifestPath: string, workspaceRoot: string) {
    this.manifestPath = resolve(manifestPath);
    this.workspaceRoot = resolve(workspaceRoot);
  }

  private async readState(): Promise<FileBindingState> {
    const [canonicalRoot, canonicalManifest] = await Promise.all([
      realpath(this.workspaceRoot),
      realpath(this.manifestPath),
    ]);
    const rootInfo = await stat(canonicalRoot);
    if (!rootInfo.isDirectory()) {
      throw new ContractError("fixture workspace root must be a directory");
    }
    if (!isDescendant(canonicalRoot, canonicalManifest)) {
      throw new ContractError(
        "fixture project manifest must be contained by the canonical workspace root",
      );
    }
    return {
      canonicalRoot,
      manifest: await loadProjectManifest(canonicalManifest),
    };
  }

  async resolve(context: HostContext): Promise<ContextBindingResult> {
    if (!context.explicitScope || !context.workspaceRoot) {
      return { kind: "missing" };
    }

    const state = await this.readState();
    const contextRoot = await realpath(context.workspaceRoot);
    if (!pathsEqual(contextRoot, state.canonicalRoot)) {
      return { kind: "context_changed" };
    }
    const manifestScope = fixtureProjectScope(state.manifest.projectId);
    if (!sameContextScope(context.explicitScope, manifestScope)) {
      return {
        kind: "ambiguous",
        scopes: [copyContextScope(manifestScope), copyContextScope(context.explicitScope)],
      };
    }

    return {
      kind: "trusted",
      scope: manifestScope,
      bindingRevision: state.manifest.bindingRevision,
      evidence: "fixture_manifest",
      selectionGeneration: context.selectionGeneration,
      workspaceRoot: state.canonicalRoot,
    };
  }

  async revalidate(
    binding: TrustedContextBinding,
  ): Promise<ContextBindingResult> {
    if (!binding.workspaceRoot) {
      return { kind: "context_changed" };
    }

    const state = await this.readState();
    const boundRoot = await realpath(binding.workspaceRoot);
    const manifestScope = fixtureProjectScope(state.manifest.projectId);
    if (
      !pathsEqual(boundRoot, state.canonicalRoot) ||
      !sameContextScope(binding.scope, manifestScope) ||
      binding.bindingRevision !== state.manifest.bindingRevision
    ) {
      return { kind: "context_changed" };
    }

    return {
      kind: "trusted",
      scope: manifestScope,
      bindingRevision: state.manifest.bindingRevision,
      evidence: "fixture_manifest",
      selectionGeneration: binding.selectionGeneration,
      workspaceRoot: state.canonicalRoot,
    };
  }
}

export class JsonContextIndex implements ContextIndexPort {
  constructor(readonly path: string) {}

  async list(binding: TrustedContextBinding): Promise<IdentityRecord[]> {
    const dataPath = await canonicalDataPath(this.path, binding);
    const raw = asObject(await loadJson(dataPath), "index");
    if (asString(raw.schema_version, "index.schema_version") !== "1.0") {
      throw new ContractError("index.schema_version must be 1.0");
    }
    const projectId = asString(raw.project_id, "index.project_id");
    if (projectId !== fixtureProjectId(binding.scope)) {
      throw new ContractError("index project does not match the trusted binding");
    }
    if (!Array.isArray(raw.records)) {
      throw new ContractError("index.records must be an array");
    }
    return parseContextIndexRecords(raw.records, binding.scope);
  }
}

interface StoredSnapshot {
  locator: string;
  snapshot: DetailSnapshot;
}

/** JSON is a deterministic fixture source, not proof of a live/current read. */
export class JsonAuthoritativeProvider implements AuthoritativeProvider {
  readonly providerId: string;

  constructor(
    readonly path: string,
    providerId = "json-fixture",
  ) {
    this.providerId = providerId;
  }

  async getDetail(request: {
    binding: TrustedContextBinding;
    entityId: string;
    entityType: string;
    authorityLocator: string;
    revisionPolicy: "current-or-explicit-stale";
    signal?: AbortSignal;
  }): Promise<AuthorityResult> {
    if (request.signal?.aborted) {
      return { kind: "unavailable", retryable: true };
    }
    if (request.revisionPolicy !== "current-or-explicit-stale") {
      throw new ContractError("unsupported authority revision policy");
    }

    const dataPath = await canonicalDataPath(this.path, request.binding);
    const raw = asObject(await loadJson(dataPath), "details");
    const providerId = asString(raw.provider_id, "details.provider_id");
    if (providerId !== this.providerId) {
      throw new ContractError("details provider_id does not match provider registration");
    }
    if (!Array.isArray(raw.snapshots)) {
      throw new ContractError("details.snapshots must be an array");
    }
    if (raw.snapshots.length > 10_000) {
      throw new ContractError("details.snapshots exceeds the P0 bound");
    }
    const snapshots: StoredSnapshot[] = raw.snapshots.map((item, index) => {
      const value = asObject(item, `details.snapshots[${index}]`);
      const wireSnapshot = asObject(
        value.snapshot,
        `details.snapshots[${index}].snapshot`,
      );
      const snapshotScope = fixtureProjectScope(
        asString(
          wireSnapshot.project_id,
          `details.snapshots[${index}].snapshot.project_id`,
        ),
      );
      return {
        locator: asString(
          value.authority_locator,
          `details.snapshots[${index}].authority_locator`,
        ),
        snapshot: parseDetailSnapshot(value.snapshot, snapshotScope),
      };
    });
    if (request.signal?.aborted) {
      return { kind: "unavailable", retryable: true };
    }

    const matches = snapshots.filter(
      (item) =>
        item.locator === request.authorityLocator &&
        sameContextScope(item.snapshot.scope, request.binding.scope) &&
        item.snapshot.entityId === request.entityId &&
        item.snapshot.entityType === request.entityType,
    );
    if (matches.length === 0) {
      return { kind: "not_found" };
    }
    if (matches.length > 1) {
      throw new ContractError("authority tuple is not unique in fixture data");
    }

    const stored = matches[0];
    if (!stored) {
      throw new ContractError("authority tuple resolution failed");
    }
    if (stored.snapshot.freshness === "current") {
      throw new ContractError(
        "fixture JSON cannot claim current freshness without live verification",
      );
    }
    return {
      kind: "snapshot",
      snapshot: stored.snapshot,
      verification: {
        verifiedAt: new Date().toISOString(),
        method: "fixture_read",
      },
    };
  }
}
