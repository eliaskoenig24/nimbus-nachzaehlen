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

/** What is published about a question; everything needed to check and count it. */
export type PublishedQuestion = {
  questionId: string
  text: string
  options: string[]
  scope: string
  /** Roots and members of every group at the moment the question was opened. */
  rootsAtOpen: Record<string, { root: string; leaves: string[] }>
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
  // The root must be one frozen when the question opened (S3): a device added later,
  // e.g. after a device change, cannot vote on a running question.
  const groupId = Object.keys(q.rootsAtOpen).find(
    (g) => q.rootsAtOpen[g].root === proof.merkleTreeRoot && q.rootsAtOpen[g].root !== "0",
  )
  if (!groupId) return { ok: false, reason: "unknown_root" }
  const answer = Number(proof.message)
  if (!Number.isSafeInteger(answer) || answer < 0 || answer >= q.options.length) {
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
}

/**
 * Recounts a question from its published data. Anyone can run this (scripts/count.ts).
 * If the chain is broken, nothing is counted.
 */
export async function tally(q: PublishedQuestion, entries: LedgerEntry[], sha256: Sha256): Promise<Tally> {
  const questionProblems: string[] = []
  if ((await questionScopeWith(sha256, q.questionId)) !== q.scope) questionProblems.push("Scope passt nicht zur Fragen-ID")
  for (const [groupId, { root, leaves }] of Object.entries(q.rootsAtOpen)) {
    const recomputed = leaves.length === 0 ? "0" : new Group(leaves.map(BigInt)).root.toString()
    if (recomputed !== root) questionProblems.push(`Wurzel der Gruppe ${groupId} passt nicht zu ihren Mitgliedern`)
  }

  const chain = await verifyChainWith(sha256, q.questionId, entries)
  const result: Tally = {
    questionProblems,
    chain,
    entries: entries.length,
    invalid: [],
    voters: 0,
    totals: q.options.map(() => 0),
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
  for (const answer of lastByNullifier.values()) result.totals[answer]++
  return result
}
