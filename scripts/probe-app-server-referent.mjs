#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { CodexAppServerClient } from "../dist/src/app-server/client.js";
import {
  createPointableReferent,
  createReferentInjectionItem,
} from "../dist/src/app-server/referent.js";
import {
  askAboutReferent,
  createReferentSession,
} from "../dist/src/app-server/referent-session.js";

const arguments_ = new Set(process.argv.slice(2));
for (const argument of arguments_) {
  if (argument !== "--verify-model") throw new Error(`unknown argument: ${argument}`);
}
const verifyModel = arguments_.has("--verify-model");
const cwd = fileURLToPath(new URL("..", import.meta.url));
const token = randomBytes(8).toString("hex");
const entityId = `POINTABLE:REFERENT-${token}`;
const revision = `rev-${token}`;
const expected = `${entityId}|${revision}|${token}`;
const now = new Date().toISOString();

const outcome = {
  kind: "detail",
  candidate: {
    scope: { kind: "workspace", namespace: "pointable-probe-v1", id: token },
    entityId,
    entityType: "synthetic_probe",
    label: "Pointable referent protocol probe",
    summary: "Synthetic data used only to verify App Server referent visibility.",
    matchKind: "exact_id",
    indexRevision: `index-${token}`,
    indexedAt: now,
    detailFreshness: "unknown",
  },
  detail: {
    scope: { kind: "workspace", namespace: "pointable-probe-v1", id: token },
    entityId,
    entityType: "synthetic_probe",
    entityRevision: revision,
    observedAt: now,
    freshness: "current",
    facts: { verificationToken: token },
    relations: [],
    sourceRefs: [{ sourceType: "synthetic_probe", sourceId: token }],
  },
  verification: { method: "live_read", verifiedAt: now },
  fallbackText: "synthetic referent probe",
};

const referent = createPointableReferent(outcome);
const item = createReferentInjectionItem(referent);
const client = await CodexAppServerClient.launch({ cwd, requestTimeoutMs: 30_000 });
let failed = false;
let probeThreadId;
let cleanedUp = false;
try {
  const initialized = await client.initialize();
  const session = await createReferentSession(client, cwd, item, {
    ephemeral: false,
    onThreadStarted: (threadId) => {
      probeThreadId = threadId;
    },
  });
  let modelVerification;
  if (verifyModel) {
    const response = await askAboutReferent(
      client,
      session.threadId,
      `Read the injected Pointable Context referent and reply with exactly ${expected}. Do not use tools.`,
    );
    modelVerification = {
      turnId: response.turnId,
      expected,
      actual: response.agentText,
      matched: response.agentText === expected,
    };
    if (!modelVerification.matched) throw new Error("model did not read the injected referent exactly");
  }
  await client.request("thread/delete", { threadId: session.threadId });
  cleanedUp = true;
  process.stdout.write(`${JSON.stringify({
    ok: true,
    codexUserAgent:
      initialized && typeof initialized === "object" && "userAgent" in initialized
        ? initialized.userAgent
        : null,
    threadId: session.threadId,
    ephemeral: false,
    deletedAfterProbe: true,
    turnsBeforeInjection: session.turnsBefore,
    turnsAfterInjection: session.turnsAfter,
    injectionCreatedTurn: false,
    referentEntityId: entityId,
    referentRevision: revision,
    modelVerification: modelVerification ?? null,
  }, null, 2)}\n`);
} catch (error) {
  failed = true;
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  const stderr = client.stderr().trim();
  if (stderr.length > 0) process.stderr.write(`app-server stderr:\n${stderr}\n`);
} finally {
  if (probeThreadId !== undefined && !cleanedUp) {
    await client.request("thread/delete", { threadId: probeThreadId }).catch(() => undefined);
  }
  await client.close();
}
if (failed) process.exitCode = 1;
