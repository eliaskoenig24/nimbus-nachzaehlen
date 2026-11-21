// Public recount of a question (spec §5). Anyone can run it with plain Node:
//
//   node count.ts https://<seite>/api/questions/<id>/ledger
//   node count.ts gespeichertes-protokoll.json
//   node count.ts <protokoll> --anchor <früher veröffentlichter anker.json>
//
// Checks: scope and roots of the question, the hash chain, every single zero-knowledge proof;
// counts only the last vote per voting ID (nullifier). With --anchor also checks that no entry
// confirmed by an earlier anchor is missing or changed. Exit code 0 = everything checks out.
import { readFile } from "node:fs/promises"
import { sha256, type LedgerEntry } from "./lib/chain.ts"
import { checkAgainstAnchor } from "./lib/anchor.ts"
import { tally, type PublishedQuestion } from "./lib/count.ts"

type LedgerFile = { format: string; question: PublishedQuestion; entries: LedgerEntry[] }

async function load<T = LedgerFile>(source: string): Promise<T> {
  if (/^https?:\/\//.test(source)) {
    const res = await fetch(source)
    if (!res.ok) throw new Error(`Abruf fehlgeschlagen: HTTP ${res.status}`)
    return (await res.json()) as T
  }
  return JSON.parse(await readFile(source, "utf8")) as T
}

async function main(): Promise<number> {
  const args = process.argv.slice(2)
  const anchorAt = args.indexOf("--anchor")
  const anchorSource = anchorAt >= 0 ? args[anchorAt + 1] : undefined
  const source = args.find((a, i) => !a.startsWith("--") && (anchorAt < 0 || i !== anchorAt + 1))
  if (!source || (anchorAt >= 0 && !anchorSource)) {
    console.error("Aufruf: node count.ts <URL oder Datei des Prüfprotokolls> [--anchor <Anker-Datei>]")
    return 2
  }
  const data = await load(source)
  if (data.format !== "ocv-ledger-v1") {
    console.error(`Unbekanntes Format: ${String(data.format)}`)
    return 2
  }
  const q = data.question
  const t = await tally(q, data.entries, sha256)

  console.log(`Frage: ${q.text} (${q.questionId})`)
  console.log(`Einträge im Protokoll: ${t.entries}`)
  let ok = true
  for (const p of t.questionProblems) {
    ok = false
    console.log(`FEHLER Frage: ${p}`)
  }
  if (t.chain.ok) {
    console.log(`Hash-Kette: in Ordnung. Letzter Prüfwert: ${t.chain.lastHash}`)
  } else {
    ok = false
    console.log(`FEHLER Hash-Kette bei Eintrag ${t.chain.seq}: ${t.chain.problem}`)
  }
  let anchorBroken = false
  if (anchorSource) {
    const anchorCheck = checkAgainstAnchor(await load<unknown>(anchorSource), q.questionId, data.entries)
    if (anchorCheck.ok) {
      console.log(`Anker: in Ordnung. ${anchorCheck.anchored} Einträge bestätigt, seitdem ${anchorCheck.addedSince} hinzugekommen.`)
    } else {
      ok = false
      anchorBroken = true
      console.log(`FEHLER Anker: ${anchorCheck.problem}`)
    }
  }
  for (const i of t.invalid) {
    ok = false
    console.log(`FEHLER Eintrag ${i.seq}: ${i.reason} (nicht gezählt)`)
  }
  if (!ok && (!t.chain.ok || t.questionProblems.length > 0 || anchorBroken)) {
    console.log("Ergebnis: NICHT AUSGEZÄHLT, weil das Protokoll nicht vertrauenswürdig ist.")
    return 1
  }
  console.log(`Abgestimmt haben: ${t.voters} (je Stimmkennung zählt nur die letzte Stimme)`)
  q.options.forEach((option, i) => console.log(`  ${option}: ${t.totals[i]}`))
  console.log(ok ? "Ergebnis: alles geprüft und in Ordnung." : "Ergebnis: gezählt, aber mit Fehlern (siehe oben).")
  return ok ? 0 : 1
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : "Fehler")
    process.exit(2)
  })
