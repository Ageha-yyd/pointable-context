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
  const byTerm = new Map<string, StudyV2ScenarioEntity>();
  for (const entity of material.entities) {
    byTerm.set(normalized(entity.id), entity);
    byTerm.set(normalized(entity.label), entity);
  }
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
    const entity = byTerm.get(normalized(request.selection.text));
    if (entity === undefined) {
      return {
        kind: "error",
        code: "study_object_not_found",
        message: "所选文字不是本试次的预注册对象。",
        retryable: false,
      } satisfies PointableLookupPresentation;
    }
    return detailFor(entity, options.revision, options.observedAt);
  };
}
