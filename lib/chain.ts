/**
 * Hash chain of the audit log (spec §5), server and counting-tool side (node:crypto).
 * The format itself lives in ./format.ts and is shared with the browser.
 *
 * This file must run with plain Node (type stripping) as part of the public counting tool,
 * so: no path aliases, relative imports with .ts extension, only Node built-ins.
 */
import { createHash } from "node:crypto"
import {
  entryInput,
  genesisInput,
  scopeInput,
  SNARK_SCALAR_FIELD,
  verifyChainWith,
  type ChainCheck,
  type LedgerEntry,
} from "./format.ts"

export { canonicalJson, type ChainCheck, type LedgerEntry, type VoteProof } from "./format.ts"

/** Question IDs: short, lower case, readable in URLs and files. */
export const QUESTION_ID = /^[a-z0-9][a-z0-9-]{0,62}$/

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}

/** Semaphore scope of a question: derived from its ID, so a proof only counts for this question. */
export function questionScope(questionId: string): string {
  return (BigInt(`0x${sha256(scopeInput(questionId))}`) % SNARK_SCALAR_FIELD).toString()
}

/** Start of the chain of a question. */
export function genesisHash(questionId: string): string {
  return sha256(genesisInput(questionId))
}

/** Hash over every field of the entry except entryHash itself. */
export function entryHash(entry: Omit<LedgerEntry, "entryHash">): string {
  return sha256(entryInput(entry))
}

/** Checks order, links and hashes of all entries of one question. */
export function verifyChain(questionId: string, entries: LedgerEntry[]): Promise<ChainCheck> {
  return verifyChainWith(sha256, questionId, entries)
}
