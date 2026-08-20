export const STUDY_V2_LANGUAGES = Object.freeze(["zh-CN", "en-US"] as const);

export type StudyV2Language = typeof STUDY_V2_LANGUAGES[number];

export function isStudyV2Language(value: unknown): value is StudyV2Language {
  return STUDY_V2_LANGUAGES.includes(value as StudyV2Language);
}

export function parseStudyV2Language(value: unknown): StudyV2Language {
  if (!isStudyV2Language(value)) throw new Error("study_v2_language_invalid");
  return value;
}

export function studyV2Text<T>(
  language: StudyV2Language,
  localized: Readonly<Record<StudyV2Language, T>>,
): T {
  return localized[language];
}
