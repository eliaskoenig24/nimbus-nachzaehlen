/**
 * Answer plus „Wie wichtig ist dir das?“ in one number (migration 010).
 *
 * The importance is part of the anonymous vote itself, so it is exactly as checkable as the answer:
 *   answer = choice + options × (importance − 1)
 * Questions without an importance scale keep answer = choice.
 *
 * No imports: runs with plain Node (counting tool), in the browser and on the server.
 */

type Shape = { options: string[]; importanceScale?: number }

/** Number of valid answer values for a question. */
export function answerValues(q: Shape): number {
  return q.options.length * (q.importanceScale ?? 1)
}

/** Null if choice or importance is out of range (importance is required exactly when the question has a scale). */
export function encodeAnswer(q: Shape, choice: number, importance: number | null): number | null {
  if (!Number.isInteger(choice) || choice < 0 || choice >= q.options.length) return null
  if (q.importanceScale === undefined) return importance === null ? choice : null
  if (importance === null || !Number.isInteger(importance) || importance < 1 || importance > q.importanceScale) return null
  return choice + q.options.length * (importance - 1)
}

/** Assumes a valid answer (0 ≤ answer < answerValues). importance is null for questions without a scale. */
export function decodeAnswer(q: Shape, answer: number): { choice: number; importance: number | null } {
  if (q.importanceScale === undefined) return { choice: answer, importance: null }
  return { choice: answer % q.options.length, importance: Math.floor(answer / q.options.length) + 1 }
}
