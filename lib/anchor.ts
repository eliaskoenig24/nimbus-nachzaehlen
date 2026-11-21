/**
 * Anchor for the daily hash (spec §5, E8): the state of every question's chain at one moment.
 *
 * Published somewhere we do not control (where is still open), it makes one attack visible
 * that the chain alone cannot catch: leaving out entries at the END of a log. A later log
 * must contain the anchored entry at exactly the anchored position.
 *
 * Runs with plain Node (counting tool): relative imports with .ts extension.
 */
import { genesisHash, sha256 } from "./chain.ts"
import { canonicalJson, type LedgerEntry } from "./format.ts"

export const ANCHOR_FORMAT = "ocv-anchor-v1"

export type AnchorQuestion = {
  questionId: string
  /** Number of entries at anchoring time. */
  entries: number
  /** entryHash of the last entry (genesis hash if there were none). */
  lastHash: string
}

export type Anchor = {
  format: typeof ANCHOR_FORMAT
  questions: AnchorQuestion[]
  /** Hash over format and questions; this short value is what gets published. */
  anchorHash: string
}

function hashOf(questions: AnchorQuestion[]): string {
  return sha256(canonicalJson({ format: ANCHOR_FORMAT, questions }))
}

export function anchorQuestion(questionId: string, entries: LedgerEntry[]): AnchorQuestion {
  const last = entries.at(-1)
  return { questionId, entries: entries.length, lastHash: last ? last.entryHash : genesisHash(questionId) }
}

export function buildAnchor(questions: AnchorQuestion[]): Anchor {
  const sorted = [...questions].sort((a, b) => a.questionId.localeCompare(b.questionId))
  return { format: ANCHOR_FORMAT, questions: sorted, anchorHash: hashOf(sorted) }
}

export type AnchorCheck =
  | { ok: true; anchored: number; addedSince: number }
  | { ok: false; problem: string }

/**
 * Checks a (later) log of one question against an anchor. More entries than anchored is fine
 * (votes cast since); fewer, or another entry at the anchored position, is not.
 */
export function checkAgainstAnchor(anchor: unknown, questionId: string, entries: LedgerEntry[]): AnchorCheck {
  const a = anchor as Partial<Anchor> | null
  if (!a || a.format !== ANCHOR_FORMAT || !Array.isArray(a.questions) || typeof a.anchorHash !== "string") {
    return { ok: false, problem: "Anker hat ein unbekanntes Format" }
  }
  if (hashOf(a.questions) !== a.anchorHash) {
    return { ok: false, problem: "Anker ist in sich nicht stimmig (Gesamt-Prüfwert passt nicht)" }
  }
  const q = a.questions.find((x) => x.questionId === questionId)
  if (!q) return { ok: false, problem: "Frage kommt im Anker nicht vor" }
  if (entries.length < q.entries) {
    return { ok: false, problem: `Protokoll hat ${entries.length} Einträge, der Anker bestätigt schon ${q.entries}: Einträge fehlen` }
  }
  const atAnchor = q.entries === 0 ? genesisHash(questionId) : entries[q.entries - 1].entryHash
  if (atAnchor !== q.lastHash) {
    return { ok: false, problem: `An Position ${q.entries} steht ein anderer Eintrag als im Anker` }
  }
  return { ok: true, anchored: q.entries, addedSince: entries.length - q.entries }
}
