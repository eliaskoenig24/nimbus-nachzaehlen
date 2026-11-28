/**
 * Validity rules for votes and the public count (spec §4, §5).
 *
 * Used by the server when accepting a vote, by the public counting tool AND by the result page
 * in the browser, so all apply exactly the same rules. Runs with plain Node (type stripping) and
 * in the browser: relative imports with .ts extension, no path aliases, no node:crypto (the
 * SHA-256 function is passed in).
 */
import { Group, verifyProof } from "@semaphore-protocol/core"
import {
  questionScopeWith,
  verifyChainWith,
  type ChainCheck,
  type LedgerEntry,
  type Sha256,
  type VoteProof,
} from "./format.ts"
import { answerValues, decodeAnswer } from "./answer.ts"

/** What is published about a question; everything needed to check and count it. */
export type PublishedQuestion = {
  questionId: string
  text: string
  options: string[]
  scope: string
  /**
   * Who may vote, per group (spec §4.1, S3): the members admitted to this question in order of
   * admission. sizes[0] = members at opening; every later size marks a brand-new person who
   * registered while the question ran. roots[i] is the root of the first sizes[i] leaves.
   * The list only grows; a device change never adds the new device to a running question.
   */
  eligible: Record<string, EligibleGroup>
  /** „Wie wichtig ist dir das?“ 1 to this number, inside the answer (./answer.ts). Absent = no importance. */
  importanceScale?: number
}

export type EligibleGroup = { leaves: string[]; sizes: number[]; roots: string[] }

/**
 * Recomputes every root of an eligibility list from its leaves. Returns a problem text, or null if
 * sizes and roots are consistent. Incremental: each leaf is hashed into the tree once.
 */
/** Appends a leaf; "0" (a member removed before opening) is placed like any other value. */
function addLeaf(group: Group, leaf: string): void {
  if (leaf === "0") {
    // Group refuses 0 directly; inserting and removing gives exactly the tree with a 0 leaf.
    group.addMember(1n)
    group.removeMember(group.size - 1)
  } else {
    group.addMember(BigInt(leaf))
  }
}

export function eligibleProblem(e: EligibleGroup): string | null {
  if (!Array.isArray(e?.leaves) || !Array.isArray(e.sizes) || !Array.isArray(e.roots)) return "unvollständig"
  if (e.sizes.length === 0 || e.sizes.length !== e.roots.length) return "Größen und Wurzeln passen nicht zusammen"
  for (let i = 0; i < e.sizes.length; i++) {
    const size = e.sizes[i]
    if (!Number.isInteger(size) || size < 0 || (i > 0 && size <= e.sizes[i - 1])) return "Größen wachsen nicht"
  }
  if (e.sizes.at(-1) !== e.leaves.length) return "letzte Größe passt nicht zu den Mitgliedern"
  if (e.leaves.some((l) => typeof l !== "string" || !NUMBER.test(l))) return "ungültiges Mitglied in der Liste"
  if (e.roots.some((r) => typeof r !== "string" || !NUMBER.test(r))) return "ungültige Wurzel in der Liste"
  const group = new Group()
  let next = 0
  for (let i = 0; i < e.sizes.length; i++) {
    while (group.size < e.sizes[i]) addLeaf(group, e.leaves[next++])
    const root = group.size === 0 ? "0" : group.root.toString()
    if (root !== e.roots[i]) return `Wurzel ${i + 1} passt nicht zu den ersten ${e.sizes[i]} Mitgliedern`
  }
  return null
}

export type VoteCheck =
  | { ok: true; groupId: string; answer: number; nullifier: string }
  | { ok: false; reason: VoteRejection }

export type VoteRejection =
  | "malformed_proof"
  | "wrong_question"
  | "unknown_root"
  | "invalid_answer"
  | "invalid_proof"

const NUMBER = /^(0|[1-9][0-9]{0,77})$/

/** Shape check only; does not trust any value yet. */
export function parseProof(value: unknown): VoteProof | null {
  if (typeof value !== "object" || value === null) return null
  const p = value as Record<string, unknown>
  const strings = ["merkleTreeRoot", "message", "nullifier", "scope"] as const
  if (strings.some((k) => typeof p[k] !== "string" || !NUMBER.test(p[k] as string))) return null
  if (typeof p.merkleTreeDepth !== "number" || !Number.isInteger(p.merkleTreeDepth)) return null
  if (p.merkleTreeDepth < 1 || p.merkleTreeDepth > 32) return null
  if (!Array.isArray(p.points) || p.points.length !== 8) return null
  if (p.points.some((x) => typeof x !== "string" || !NUMBER.test(x))) return null
  return {
    merkleTreeDepth: p.merkleTreeDepth,
    merkleTreeRoot: p.merkleTreeRoot as string,
    message: p.message as string,
    nullifier: p.nullifier as string,
    scope: p.scope as string,
    points: p.points as string[],
  }
}

/** Every rule except the (expensive) zero-knowledge check. */
export function checkVoteRules(q: PublishedQuestion, proof: VoteProof): VoteCheck {
  // The proof must be made for exactly this question; a proof for another question has
  // another scope, and therefore also another nullifier.
  if (proof.scope !== q.scope) return { ok: false, reason: "wrong_question" }
  // The root must be one published for this question (S3): members at opening, or a brand-new
  // person admitted later. A device added by a device change never gets a root here.
  const groupId = Object.keys(q.eligible).find(
    (g) => proof.merkleTreeRoot !== "0" && q.eligible[g].roots.includes(proof.merkleTreeRoot),
  )
  if (!groupId) return { ok: false, reason: "unknown_root" }
  const answer = Number(proof.message)
  if (!Number.isSafeInteger(answer) || answer < 0 || answer >= answerValues(q)) {
    return { ok: false, reason: "invalid_answer" }
  }
  return { ok: true, groupId, answer, nullifier: proof.nullifier }
}

/** All rules including the zero-knowledge proof. */
export async function checkVote(q: PublishedQuestion, proofValue: unknown): Promise<VoteCheck> {
  const proof = parseProof(proofValue)
  if (!proof) return { ok: false, reason: "malformed_proof" }
  const rules = checkVoteRules(q, proof)
  if (!rules.ok) return rules
  let valid = false
  try {
    valid = await verifyProof(proof as never)
  } catch {
    valid = false
  }
  return valid ? rules : { ok: false, reason: "invalid_proof" }
}

export type Tally = {
  /** Problems with the published question itself (scope or roots do not match). */
  questionProblems: string[]
  chain: ChainCheck
  entries: number
  /** Entries that should never have been accepted. Any entry here is a serious finding. */
  invalid: { seq: number; reason: string }[]
  /** Distinct voting IDs (nullifiers) with a valid vote = number of people who voted. */
  voters: number
  /** Counted votes per option; only the last vote per nullifier counts (re-voting, spec §4.4). */
  totals: number[]
  /** Sum of the importance given, per option (null for questions without importance). */
  importanceSums: number[] | null
}

/**
 * Recounts a question from its published data. Anyone can run this (scripts/count.ts).
 * If the chain is broken, nothing is counted.
 */
export async function tally(q: PublishedQuestion, entries: LedgerEntry[], sha256: Sha256): Promise<Tally> {
  const questionProblems: string[] = []
  if ((await questionScopeWith(sha256, q.questionId)) !== q.scope) questionProblems.push("Scope passt nicht zur Fragen-ID")
  const scale = q.importanceScale
  if (scale !== undefined && (!Number.isInteger(scale) || scale < 2 || scale > 10)) {
    questionProblems.push("Ungültige Skala für die Wichtigkeit")
  }
  for (const [groupId, e] of Object.entries(q.eligible)) {
    const problem = eligibleProblem(e)
    if (problem) questionProblems.push(`Gruppe ${groupId}: ${problem}`)
  }

  const chain = await verifyChainWith(sha256, q.questionId, entries)
  const result: Tally = {
    questionProblems,
    chain,
    entries: entries.length,
    invalid: [],
    voters: 0,
    totals: q.options.map(() => 0),
    importanceSums: q.importanceScale === undefined ? null : q.options.map(() => 0),
  }
  if (!chain.ok || questionProblems.length > 0) return result

  const lastByNullifier = new Map<string, number>()
  for (const e of entries) {
    const check = await checkVote(q, e.proof)
    if (!check.ok) {
      result.invalid.push({ seq: e.seq, reason: check.reason })
      continue
    }
    // The stored fields must say the same as the proof.
    if (check.answer !== e.answer || check.nullifier !== e.nullifier || check.groupId !== e.groupId ||
        e.proof.merkleTreeRoot !== e.merkleRoot) {
      result.invalid.push({ seq: e.seq, reason: "Eintrag widerspricht seinem Nachweis" })
      continue
    }
    lastByNullifier.set(check.nullifier, check.answer)
  }
  result.voters = lastByNullifier.size
  for (const answer of lastByNullifier.values()) {
    const { choice, importance } = decodeAnswer(q, answer)
    result.totals[choice]++
    if (result.importanceSums && importance !== null) result.importanceSums[choice] += importance
  }
  return result
}
