import type {
  PointableLookupCallback,
  PointableLookupCallbackRequest,
} from "../../host/codex-cdp/adapter.js";
import type { PointableLookupPresentation } from "../../host/codex-cdp/protocol.js";
import type {
  StudyV2NativeTrialMaterial,
  StudyV2ScenarioEntity,
} from "./native-trial-pack.js";

function normalized(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

function entitiesInSelection(
  selectionText: string,
  entities: readonly StudyV2ScenarioEntity[],
): StudyV2ScenarioEntity[] {
  const selection = normalized(selectionText);
  const matches = new Map<string, StudyV2ScenarioEntity>();
  for (const entity of entities) {
    const terms = [entity.id, entity.label].map(normalized);
    if (terms.some((term) => selection.includes(term))) {
      matches.set(entity.id, entity);
    }
  }
  return [...matches.values()];
}

function detailFor(
  entity: StudyV2ScenarioEntity,
  revision: string,
  observedAt: string,
): PointableLookupPresentation {
  return {
    kind: "detail",
    detail: {
      entityId: entity.id,
      entityType: entity.type,
      label: entity.label,
      summary: entity.meaning,
      humanSummary: entity.meaning,
      revision,
      observedAt,
      freshness: "current",
      facts: [
        { label: "为什么现在出现", value: entity.whyNow },
        { label: "不能据此推出", value: entity.boundary },
      ],
      sources: [{ label: `sealed scenario · ${entity.evidence}` }],
      comprehension: {
        kind: "concept",
        meaning: entity.meaning,
        context: entity.whyNow,
        boundary: entity.boundary,
        sequence: [...entity.flow],
        currentStep: entity.flow.length - 1,
        evidence: [{ excerpt: "冻结研究场景中的显式项目状态", source: entity.evidence }],
      },
    },
  };
}

export function createStudyV2NativeLookup(
  material: StudyV2NativeTrialMaterial,
  options: { revision: string; observedAt: string },
): PointableLookupCallback {
  return async (request: Readonly<PointableLookupCallbackRequest>) => {
    if (request.signal.aborted) throw new Error("study_v2_lookup_aborted");
    if (request.operation !== "resolve") {
      return {
        kind: "error",
        code: "study_operation_unavailable",
        message: "冻结试次只支持首次查看。",
        retryable: false,
      } satisfies PointableLookupPresentation;
    }
    const matches = entitiesInSelection(request.selection.text, material.entities);
    if (matches.length !== 1) {
      return {
        kind: "error",
        code: "study_object_not_found",
        message: matches.length === 0
          ? "所选文字中没有本试次的预注册对象。"
          : "所选文字包含多个预注册对象，请缩小选择范围。",
        retryable: false,
      } satisfies PointableLookupPresentation;
    }
    const [entity] = matches;
    if (entity === undefined) throw new Error("study_object_resolution_invalid");
    return detailFor(entity, options.revision, options.observedAt);
  };
}
