// Daily run (GitHub Action, or by hand): saves the current anchor and every audit log of
// Nimbus in this repository and recounts each log against the last earlier anchor.
//
//   node taeglich.ts                       (site: https://nimbus.vote)
//   NIMBUS_URL=https://… node taeglich.ts  (another instance)
//
// Exit code 0 = everything checks out. Anything else: a log is broken, shorter than an earlier
// anchor confirmed, or the site could not be reached. Git history keeps every earlier state.
import { execFile } from "node:child_process"
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"

const run = promisify(execFile)
const SITE = (process.env.NIMBUS_URL ?? "https://nimbus.vote").replace(/\/+$/, "")
const QUESTION_ID = /^[a-z0-9-]{1,63}$/
const ANCHORS = "anker"
const LOGS = "protokolle"

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Abruf fehlgeschlagen (${res.status}): ${url}`)
  return res.json()
}

type Anchor = { format: string; questions: { questionId: string }[] }

/** Latest anchor file before `today` that mentions the question. */
async function previousAnchorFor(questionId: string, today: string): Promise<string | null> {
  const files = (await readdir(ANCHORS)).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f) && f < `${today}.json`)
  for (const file of files.sort().reverse()) {
    const a = JSON.parse(await readFile(path.join(ANCHORS, file), "utf8")) as Anchor
    if (a.questions?.some((q) => q.questionId === questionId)) return path.join(ANCHORS, file)
  }
  return null
}

async function main(): Promise<number> {
  await mkdir(ANCHORS, { recursive: true })
  await mkdir(LOGS, { recursive: true })
  const today = new Date().toISOString().slice(0, 10)

  const anchor = (await getJson(`${SITE}/api/anchor`)) as Anchor
  if (anchor?.format !== "ocv-anchor-v1" || !Array.isArray(anchor.questions)) {
    console.error("Anker hat ein unbekanntes Format.")
    return 1
  }
  await writeFile(path.join(ANCHORS, `${today}.json`), `${JSON.stringify(anchor, null, 2)}\n`)
  console.log(`Anker ${today}: ${anchor.questions.length} Fragen.`)

  let ok = true
  for (const { questionId } of anchor.questions) {
    if (!QUESTION_ID.test(questionId)) {
      console.error(`Ungültige Fragen-ID im Anker: ${JSON.stringify(questionId)}`)
      ok = false
      continue
    }
    const file = path.join(LOGS, `${questionId}.json`)
    await writeFile(file, `${JSON.stringify(await getJson(`${SITE}/api/questions/${questionId}/ledger`), null, 2)}\n`)
    const previous = await previousAnchorFor(questionId, today)
    const args = ["count.ts", file, ...(previous ? ["--anchor", previous] : [])]
    try {
      const { stdout } = await run(process.execPath, args)
      console.log(stdout)
    } catch (err) {
      ok = false
      console.log((err as { stdout?: string }).stdout ?? "")
      console.error(`FEHLER bei ${questionId}`)
    }
  }
  return ok ? 0 : 1
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : "Fehler")
    process.exit(1)
  })
