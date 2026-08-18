import assert from "node:assert/strict";
import test from "node:test";
import {
  decisionDocumentPath,
  extractDecisionDocumentContext,
  extractJsonConfigurationContext,
  extractStaticTestDefinitionContext,
  jsonConfigurationPath,
  testSourcePath,
} from "../src/adapters/workspace-scenario.js";

test("test-source context exposes static scope without claiming execution", () => {
  assert.equal(testSourcePath("test/host-workspace.test.ts"), true);
  assert.equal(testSourcePath("src/host-workspace.ts"), false);
  const context = extractStaticTestDefinitionContext(`
    test("refreshes the same card", () => {});
    it('keeps the old snapshot when deleted', () => {});
    test(dynamicTitle, () => {});
  `);
  assert.equal(context.titleCount, 2);
  assert.match(context.summary, /检测到 2 个静态 test\/it 标题/u);
  assert.doesNotMatch(context.summary, /PASS|通过/u);
});

test("configuration context exposes bounded key names but never values", () => {
  assert.equal(jsonConfigurationPath("package.json"), true);
  assert.equal(jsonConfigurationPath("fixtures/data.json"), false);
  const context = extractJsonConfigurationContext("package.json", JSON.stringify({
    name: "secret-package-name",
    scripts: { start: "token=do-not-show" },
    private: true,
    dependencies: { confidential: "1.0.0" },
    devDependencies: {},
    engines: {},
  }));
  assert.equal(context.parsed, true);
  assert.equal(context.keyCount, 6);
  assert.deepEqual(context.topLevelKeys, ["name", "scripts", "private", "dependencies", "devDependencies"]);
  assert.doesNotMatch(JSON.stringify(context), /secret-package-name|do-not-show|confidential/u);
});

test("decision context reads only explicit ADR sections", () => {
  assert.equal(decisionDocumentPath("docs/adr/ADR-007-refresh.md"), true);
  assert.equal(decisionDocumentPath("docs/guide.md"), false);
  const context = extractDecisionDocumentContext(`
    # ADR-007
    ## Status
    Accepted
    ## Context
    Users must not lose the snapshot they are reading.
    ## Decision
    Refresh only after a trusted explicit action.
    ## Consequences
    Background work stays lightweight.
  `);
  assert.equal(context.status, "Accepted");
  assert.equal(context.decision, "Refresh only after a trusted explicit action.");
  assert.match(context.rationale ?? "", /must not lose/u);
  assert.match(context.consequences ?? "", /stays lightweight/u);
});
