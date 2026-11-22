/**
 * Format of the audit log (spec §5), shared by server, browser and the public counting tool.
 * No imports at all: runs with plain Node, in the browser and in the bundler. The hash
 * function is passed in (node:crypto on the server, Web Crypto in the browser), so the chain
 * logic exists exactly once.
 */

export const LEDGER_VERSION = "ocv-ledger-v1"

/**
 * Format of the published file / API answer (question + entries). Separate from LEDGER_VERSION,
 * which is part of every hash and must never change. v2 (E20): `question.eligible` replaces
 * `question.rootsAtOpen`.
 */
export const LEDGER_FILE_FORMAT = "ocv-ledger-v2"

/** Semaphore proof as produced by @semaphore-protocol/proof 4.x. */
export type VoteProof = {
  merkleTreeDepth: number
  merkleTreeRoot: string
  message: string
  nullifier: string
  scope: string
  points: string[]
}

/** One entry as stored and published. */
export type LedgerEntry = {
  questionId: string
  seq: number
  groupId: string
  merkleRoot: string
  nullifier: string
  answer: number
  proof: VoteProof
  prevHash: string
  entryHash: string
}

/** SHA-256 as lower-case hex. */
export type Sha256 = (text: string) => string | Promise<string>

/**
 * JSON with sorted keys at every level, so the hash does not depend on key order
 * (Postgres jsonb, for example, reorders keys).
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`
}

export const scopeInput = (questionId: string) => `${LEDGER_VERSION}|scope|${questionId}`

/** BN254 scalar field size; a Semaphore scope must be smaller. */
export const SNARK_SCALAR_FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n

/** Semaphore scope of a question, with the given SHA-256 (server or browser). */
export async function questionScopeWith(sha256: Sha256, questionId: string): Promise<string> {
  return (BigInt(`0x${await sha256(scopeInput(questionId))}`) % SNARK_SCALAR_FIELD).toString()
}
export const genesisInput = (questionId: string) => `${LEDGER_VERSION}|genesis|${questionId}`

/** Text hashed for an entry: every field except entryHash itself. */
export function entryInput(entry: Omit<LedgerEntry, "entryHash">): string {
  const { questionId, seq, groupId, merkleRoot, nullifier, answer, proof, prevHash } = entry
  return `${LEDGER_VERSION}|entry|${canonicalJson({ questionId, seq, groupId, merkleRoot, nullifier, answer, proof, prevHash })}`
}

export type ChainCheck = { ok: true; lastHash: string } | { ok: false; seq: number; problem: string }

/** Checks order, links and hashes of all entries of one question. */
export async function verifyChainWith(
  sha256: Sha256,
  questionId: string,
  entries: LedgerEntry[],
): Promise<ChainCheck> {
  let prev = await sha256(genesisInput(questionId))
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    if (e.questionId !== questionId) return { ok: false, seq: e.seq, problem: "fremde Frage" }
    if (e.seq !== i + 1) return { ok: false, seq: e.seq, problem: `Lücke oder falsche Reihenfolge (erwartet ${i + 1})` }
    if (e.prevHash !== prev) return { ok: false, seq: e.seq, problem: "Verkettung gebrochen" }
    const { entryHash: stated, ...rest } = e
    if ((await sha256(entryInput(rest))) !== stated) return { ok: false, seq: e.seq, problem: "Eintrag verändert" }
    prev = stated
  }
  return { ok: true, lastHash: prev }
}
