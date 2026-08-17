import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import type { TrustedContextBinding } from "../src/contracts.js";
import {
  FixtureFileProjectBinding,
  JsonAuthoritativeProvider,
  JsonContextIndex,
  fixtureProjectScope,
} from "../src/adapters/json-files.js";
import { sameContextScope } from "../src/context-scope.js";

const fixture = resolve("fixtures/mini-project");
const fixtureManifest = resolve(fixture, "project-context.json");

function fixtureBinding(): FixtureFileProjectBinding {
  return new FixtureFileProjectBinding(fixtureManifest, fixture);
}

async function resolveFixtureBinding(): Promise<TrustedContextBinding> {
  const result = await fixtureBinding().resolve({
    explicitScope: fixtureProjectScope("PRJ-01"),
    selectionGeneration: 1,
    workspaceRoot: fixture,
  });
  assert.equal(result.kind, "trusted");
  if (result.kind !== "trusted") {
    throw new Error("fixture binding was not trusted");
  }
  return result;
}

async function writeManifest(
  path: string,
  projectId: string,
  bindingRevision: string,
): Promise<void> {
  await writeFile(
    path,
    `${JSON.stringify(
      {
        schema_version: "1.0",
        project_id: projectId,
        binding_revision: bindingRevision,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

test("fixture file binding requires matching explicit project and canonical root", async () => {
  const binding = fixtureBinding();
  assert.deepEqual(
    await binding.resolve({ selectionGeneration: 1, workspaceRoot: fixture }),
    { kind: "missing" },
  );
  assert.deepEqual(
    await binding.resolve({
      explicitScope: fixtureProjectScope("PRJ-01"),
      selectionGeneration: 1,
    }),
    { kind: "missing" },
  );

  const conflict = await binding.resolve({
    explicitScope: fixtureProjectScope("PRJ-02"),
    selectionGeneration: 1,
    workspaceRoot: fixture,
  });
  assert.equal(conflict.kind, "ambiguous");

  const trusted = await binding.resolve({
    explicitScope: fixtureProjectScope("PRJ-01"),
    selectionGeneration: 1,
    workspaceRoot: join(fixture, "."),
    threadRef: "not-authoritative-in-this-adapter",
    routeRef: "not-authoritative-in-this-adapter",
  });
  assert.equal(trusted.kind, "trusted");
  if (trusted.kind === "trusted") {
    assert.equal(trusted.evidence, "fixture_manifest");
    assert.equal(trusted.workspaceRoot, await realpath(fixture));
    assert.equal(trusted.threadRef, undefined);
    assert.equal(trusted.routeRef, undefined);
  }

  const otherRoot = await mkdtemp(join(tmpdir(), "pointable-other-root-"));
  try {
    assert.equal(
      (
        await binding.resolve({
          explicitScope: fixtureProjectScope("PRJ-01"),
          selectionGeneration: 1,
          workspaceRoot: otherRoot,
        })
      ).kind,
      "context_changed",
    );
  } finally {
    await rm(otherRoot, { recursive: true, force: true });
  }
});

test("fixture manifest must remain inside its pinned canonical root", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "pointable-root-boundary-"));
  const root = join(sandbox, "project");
  const outsideManifest = join(sandbox, "outside-project-context.json");
  await mkdir(root);
  await writeManifest(outsideManifest, "PRJ-01", "r1");

  try {
    const binding = new FixtureFileProjectBinding(outsideManifest, root);
    await assert.rejects(
      binding.resolve({
        explicitScope: fixtureProjectScope("PRJ-01"),
        selectionGeneration: 1,
        workspaceRoot: root,
      }),
      /must be contained by the canonical workspace root/,
    );
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("fixture binding reloads manifest and fails closed on project, revision, or root drift", async () => {
  const root = await mkdtemp(join(tmpdir(), "pointable-manifest-reload-"));
  const manifestPath = join(root, "project-context.json");
  await writeManifest(manifestPath, "PRJ-01", "r1");

  try {
    const adapter = new FixtureFileProjectBinding(manifestPath, root);
    const initial = await adapter.resolve({
      explicitScope: fixtureProjectScope("PRJ-01"),
      selectionGeneration: 7,
      workspaceRoot: root,
    });
    assert.equal(initial.kind, "trusted");
    if (initial.kind !== "trusted") return;
    assert.equal((await adapter.revalidate(initial)).kind, "trusted");

    assert.equal(
      (
        await adapter.revalidate({
          ...initial,
          scope: fixtureProjectScope("PRJ-FORGED"),
        })
      ).kind,
      "context_changed",
    );
    assert.equal(
      (
        await adapter.revalidate({
          ...initial,
          bindingRevision: "forged-revision",
        })
      ).kind,
      "context_changed",
    );

    const otherRoot = await mkdtemp(join(tmpdir(), "pointable-bound-root-"));
    try {
      assert.equal(
        (
          await adapter.revalidate({
            ...initial,
            workspaceRoot: otherRoot,
          })
        ).kind,
        "context_changed",
      );
    } finally {
      await rm(otherRoot, { recursive: true, force: true });
    }

    await writeManifest(manifestPath, "PRJ-01", "r2");
    assert.equal((await adapter.revalidate(initial)).kind, "context_changed");
    const revisionTwo = await adapter.resolve({
      explicitScope: fixtureProjectScope("PRJ-01"),
      selectionGeneration: 8,
      workspaceRoot: root,
    });
    assert.equal(revisionTwo.kind, "trusted");
    if (revisionTwo.kind === "trusted") {
      assert.equal(revisionTwo.bindingRevision, "r2");
    }

    await writeManifest(manifestPath, "PRJ-02", "r3");
    assert.equal((await adapter.revalidate(initial)).kind, "context_changed");
    assert.equal(
      (
        await adapter.resolve({
          explicitScope: fixtureProjectScope("PRJ-01"),
          selectionGeneration: 9,
          workspaceRoot: root,
        })
      ).kind,
      "ambiguous",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fixture index and authority provider preserve the full identity tuple", async () => {
  const binding = await resolveFixtureBinding();
  const records = await new JsonContextIndex(resolve(fixture, "index.json")).list(binding);
  assert.equal(records.length, 3);
  const gov = records.find((record) => record.canonicalKey === "GOV-1");
  assert.ok(gov);

  const provider = new JsonAuthoritativeProvider(resolve(fixture, "details.json"));
  const request = {
    binding,
    entityId: gov.entityId,
    entityType: gov.entityType,
    authorityLocator: gov.authorityRef.locator,
    revisionPolicy: "current-or-explicit-stale" as const,
  };
  const result = await provider.getDetail(request);
  assert.equal(result.kind, "snapshot");
  if (result.kind === "snapshot") {
    assert.equal(sameContextScope(result.snapshot.scope, binding.scope), true);
    assert.equal(result.snapshot.entityId, gov.entityId);
    assert.equal(result.snapshot.entityType, gov.entityType);
    assert.equal(result.snapshot.freshness, "stale");
    assert.equal(result.snapshot.sourceRefs.length, 1);
    assert.equal(result.verification.method, "fixture_read");
    assert.ok(Number.isFinite(Date.parse(result.verification.verifiedAt)));
  }

  const tupleMismatches = [
    { ...request, entityId: "WU:OTHER" },
    { ...request, entityType: "decision" },
    { ...request, authorityLocator: "work-units/other" },
    { ...request, binding: { ...binding, scope: fixtureProjectScope("PRJ-OTHER") } },
  ];
  for (const mismatched of tupleMismatches) {
    assert.deepEqual(await provider.getDetail(mismatched), { kind: "not_found" });
  }
});

test("fixture authority provider enforces its revision policy at runtime", async () => {
  const binding = await resolveFixtureBinding();
  const provider = new JsonAuthoritativeProvider(resolve(fixture, "details.json"));
  await assert.rejects(
    provider.getDetail({
      binding,
      entityId: "WU:GOV-1",
      entityType: "work_unit",
      authorityLocator: "work-units/gov-1",
      revisionPolicy: "latest" as never,
    }),
    /unsupported authority revision policy/,
  );
});

test("fixture authority provider refuses to claim current freshness", async () => {
  const root = await mkdtemp(join(tmpdir(), "pointable-current-fixture-"));
  const detailsPath = join(root, "details.json");
  const details = JSON.parse(
    await readFile(resolve(fixture, "details.json"), "utf8"),
  ) as {
    snapshots: Array<{ snapshot: { freshness: string } }>;
  };
  const first = details.snapshots[0];
  assert.ok(first);
  first.snapshot.freshness = "current";
  await writeManifest(join(root, "project-context.json"), "PRJ-01", "r1");
  await writeFile(detailsPath, `${JSON.stringify(details, null, 2)}\n`, "utf8");

  try {
    const bindingResult = await new FixtureFileProjectBinding(
      join(root, "project-context.json"),
      root,
    ).resolve({
      explicitScope: fixtureProjectScope("PRJ-01"),
      selectionGeneration: 1,
      workspaceRoot: root,
    });
    assert.equal(bindingResult.kind, "trusted");
    if (bindingResult.kind !== "trusted") return;
    const provider = new JsonAuthoritativeProvider(detailsPath);
    await assert.rejects(
      provider.getDetail({
        binding: bindingResult,
        entityId: "WU:GOV-1",
        entityType: "work_unit",
        authorityLocator: "work-units/gov-1",
        revisionPolicy: "current-or-explicit-stale",
      }),
      /fixture JSON cannot claim current freshness/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fixture data files cannot escape the bound canonical root", async () => {
  const binding = await resolveFixtureBinding();
  const outside = await mkdtemp(join(tmpdir(), "pointable-data-escape-"));
  const outsideIndex = join(outside, "index.json");
  const outsideDetails = join(outside, "details.json");
  await Promise.all([
    writeFile(outsideIndex, await readFile(resolve(fixture, "index.json"))),
    writeFile(outsideDetails, await readFile(resolve(fixture, "details.json"))),
  ]);

  try {
    await assert.rejects(
      new JsonContextIndex(outsideIndex).list(binding),
      /must remain inside the bound workspace root/u,
    );
    await assert.rejects(
      new JsonAuthoritativeProvider(outsideDetails).getDetail({
        binding,
        entityId: "WU:GOV-1",
        entityType: "work_unit",
        authorityLocator: "work-units/gov-1",
        revisionPolicy: "current-or-explicit-stale",
      }),
      /must remain inside the bound workspace root/u,
    );
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});
