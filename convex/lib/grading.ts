import type { AnswerKey, ResponseValue } from "./validators";

/** Short answers match after trimming and collapsing spaces; case only matters if the lecturer said so. */
export function normalizeShortAnswer(text: string, caseSensitive: boolean): string {
  const collapsed = text.trim().replace(/\s+/g, " ");
  return caseSensitive ? collapsed : collapsed.toLocaleLowerCase();
}

/**
 * Points for one single-choice, multiple-choice or short answer: all or nothing
 * (multiple choice needs exactly the right set). An unanswered question gets 0.
 * Essays wait for the lecturer and code is graded by its checks, so both are
 * undefined here.
 */
export function scoreAnswer(key: AnswerKey | null, value: ResponseValue | undefined, points: number): number | undefined {
  if (key === null) {
    return undefined;
  }
  switch (key.type) {
    case "single":
      return value?.type === "single" && value.optionId === key.correctOptionId ? points : 0;
    case "multiple": {
      if (value?.type !== "multiple") return 0;
      const chosen = new Set(value.optionIds);
      return chosen.size === key.correctOptionIds.length && key.correctOptionIds.every((id) => chosen.has(id))
        ? points
        : 0;
    }
    case "short": {
      if (value?.type !== "short") return 0;
      const answer = normalizeShortAnswer(value.text, key.caseSensitive);
      return answer !== "" && key.acceptedAnswers.some((a) => normalizeShortAnswer(a, key.caseSensitive) === answer)
        ? points
        : 0;
    }
    case "essay":
    case "code":
      return undefined;
  }
}

/** Whether a saved answer counts as answered on the lecturer's list. Code counts steps instead. */
export function isAnswered(value: ResponseValue | undefined): boolean {
  switch (value?.type) {
    case "single":
      return true;
    case "multiple":
      return value.optionIds.length > 0;
    case "short":
    case "essay":
      return value.text.trim() !== "";
    default:
      return false;
  }
}

/** An essay the student wrote something for that no lecturer has scored yet. */
export function awaitsGrading(value: ResponseValue, manualPoints: number | undefined): boolean {
  return value.type === "essay" && value.text.trim() !== "" && manualPoints === undefined;
}
