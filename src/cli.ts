#!/usr/bin/env node
import { readFile } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { LookupOutcome, SourceSurface } from "./contracts.js";
import { evaluateEligibility } from "./eligibility.js";
import { LookupService } from "./lookup-service.js";
import {
  FixtureFileProjectBinding,
  JsonAuthoritativeProvider,
  JsonContextIndex,
  fixtureProjectId,
  fixtureProjectScope,
  loadProjectManifest,
} from "./adapters/json-files.js";

interface CliIo {
  stdout(message: string): void;
  stderr(message: string): void;
}

interface ParsedArgs {
  command: string | undefined;
  options: Map<string, string | true>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  const options = new Map<string, string | true>();
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index]!;
    if (!token.startsWith("--")) {
      throw new Error(`unexpected argument: ${token}`);
    }
    const name = token.slice(2);
    if (name === "json" || name === "stdin" || name === "allow-argv-text") {
      options.set(name, true);
      continue;
    }
    const value = rest[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`missing value for --${name}`);
    }
    options.set(name, value);
    index += 1;
  }
  return { command, options };
}

function required(options: Map<string, string | true>, name: string): string {
  const value = options.get(name);
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`--${name} is required`);
  }
  return value;
}

async function readSelection(options: Map<string, string | true>): Promise<string> {
  const argvText = options.get("text");
  const readsStdin = options.has("stdin");

  if (readsStdin && typeof argvText === "string") {
    throw new Error("use either --stdin or --text, not both");
  }
  if (readsStdin) {
    return new Promise<string>((resolveInput, rejectInput) => {
      readFile(0, "utf8", (error, data) => {
        if (error) rejectInput(error);
        else resolveInput(data);
      });
    });
  }
  if (typeof argvText === "string") {
    if (!options.has("allow-argv-text")) {
      throw new Error(
        "--text can expose the selection in the process list; use --stdin, or explicitly add --allow-argv-text",
      );
    }
    return argvText;
  }
  throw new Error(
    "selection input is required; use --stdin (recommended), or --text with --allow-argv-text",
  );
}

function redactedEligibility(
  result: ReturnType<typeof evaluateEligibility>,
  input: { text: string; surface: SourceSurface; selectionGeneration: number },
): Record<string, unknown> {
  const common = {
    surface: input.surface,
    selectionGeneration: input.selectionGeneration,
    textLength: input.text.trim().length,
  };
  return result.kind === "eligible"
    ? { kind: result.kind, ...common }
    : { kind: result.kind, reason: result.reason, ...common };
}

function projectCandidate(candidate: LookupOutcome & { kind: "candidates" }) {
  return candidate.candidates.map(({ scope, ...match }) => ({
    ...match,
    projectId: fixtureProjectId(scope),
  }));
}

/** Preserve the existing fixture CLI JSON shape at the compatibility boundary. */
function legacyProjectOutcome(outcome: LookupOutcome): unknown {
  if (outcome.kind === "candidates") {
    return { ...outcome, candidates: projectCandidate(outcome) };
  }
  if (outcome.kind === "detail") {
    const { scope: candidateScope, ...candidate } = outcome.candidate;
    const { scope: detailScope, ...detail } = outcome.detail;
    return {
      ...outcome,
      candidate: {
        ...candidate,
        projectId: fixtureProjectId(candidateScope),
      },
      detail: {
        ...detail,
        projectId: fixtureProjectId(detailScope),
      },
    };
  }
  return outcome;
}

function usage(): string {
  return [
    "Usage:",
    "  <selection> | pointable eligible --stdin [--surface assistant_message|user_message] [--json]",
    "  <selection> | pointable lookup --stdin --project-dir <directory> [--choose <entity-id>] [--json]",
    "  pointable <command> --text <selection> --allow-argv-text ...  # explicit, less private alternative",
  ].join("\n");
}

export async function runCli(
  argv: string[],
  io: CliIo = {
    stdout: (message) => process.stdout.write(`${message}\n`),
    stderr: (message) => process.stderr.write(`${message}\n`),
  },
): Promise<number> {
  try {
    const parsed = parseArgs(argv);
    if (parsed.command === "eligible") {
      const text = await readSelection(parsed.options);
      const surface = (parsed.options.get("surface") ??
        "assistant_message") as SourceSurface;
      const input = {
        text,
        surface,
        selectionGeneration: 1,
      };
      const result = evaluateEligibility(input);
      io.stdout(
        parsed.options.has("json")
          ? JSON.stringify(redactedEligibility(result, input), null, 2)
          : result.kind === "eligible"
            ? "Selection is eligible for an explicit lookup action."
            : `Selection is ineligible: ${result.reason}.`,
      );
      return result.kind === "eligible" ? 0 : 1;
    }

    if (parsed.command === "lookup") {
      const projectDir = resolve(required(parsed.options, "project-dir"));
      const text = await readSelection(parsed.options);
      const manifestPath = resolve(projectDir, "project-context.json");
      const manifest = await loadProjectManifest(manifestPath);
      const service = new LookupService(
        new FixtureFileProjectBinding(manifestPath, projectDir),
        new JsonContextIndex(resolve(projectDir, "index.json")),
        [
          new JsonAuthoritativeProvider(
            resolve(projectDir, "details.json"),
            "json-fixture",
          ),
        ],
      );
      const chosen = parsed.options.get("choose");
      const selection = {
        text,
        surface: "assistant_message" as const,
        selectionGeneration: 1,
      };
      const hostContext = {
        explicitScope: fixtureProjectScope(manifest.projectId),
        workspaceRoot: projectDir,
        selectionGeneration: 1,
      };
      const chosenEntityId = typeof chosen === "string" ? chosen : undefined;
      const activation = service.issueActivation(
        selection,
        hostContext,
        chosenEntityId,
      );
      if (activation.kind !== "issued") {
        const message =
          activation.kind === "capacity_exceeded"
            ? "Activation capacity is temporarily exhausted."
            : `Selection is ineligible: ${activation.reason}.`;
        io.stdout(
          parsed.options.has("json")
            ? JSON.stringify(
                activation.kind === "capacity_exceeded"
                  ? { kind: "unavailable", reason: "activation_capacity" }
                  : { kind: "blocked", reason: activation.reason },
                null,
                2,
              )
            : message,
        );
        return activation.kind === "capacity_exceeded" ? 3 : 2;
      }
      const outcome = await service.submitLookupIntent({
        ...activation.ticket,
        selection,
        hostContext,
        ...(chosenEntityId !== undefined ? { chosenEntityId } : {}),
      });
      io.stdout(
        parsed.options.has("json")
          ? JSON.stringify(legacyProjectOutcome(outcome), null, 2)
          : outcome.fallbackText,
      );
      if (outcome.kind === "blocked") return 2;
      if (outcome.kind === "unavailable") return 3;
      if (outcome.kind === "candidates") return 4;
      if (outcome.kind === "no_match") return 5;
      if (outcome.kind === "overflow") return 6;
      return 0;
    }

    io.stderr(usage());
    return 1;
  } catch (error) {
    io.stderr(error instanceof Error ? error.message : "unknown CLI error");
    return 2;
  }
}

const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isDirectRun) {
  process.exitCode = await runCli(process.argv.slice(2));
}
