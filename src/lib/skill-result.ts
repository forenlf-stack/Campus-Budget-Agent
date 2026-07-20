export interface SkillError {
  code: string;
  message: string;
}

export type SkillResult<T> =
  | { success: true; data: T }
  | { success: false; error: SkillError };

export function skillSuccess<T>(data: T): SkillResult<T> {
  return { success: true, data };
}

export function skillFailure(code: string, message: string): SkillResult<never> {
  return { success: false, error: { code, message } };
}
