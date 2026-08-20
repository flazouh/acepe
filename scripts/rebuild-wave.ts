#!/usr/bin/env bun
/**
 * Reports which rebuild tickets are dispatchable right now.
 *
 * A ticket is ready when every id in its `blocked_by` frontmatter is done.
 * Done tickets are read from docs/plans/electrobun-rebuild/DONE (one id per line).
 */
import { readFileSync, readdirSync, existsSync } from "node:fs"
import { resolve } from "node:path"

const DIR = resolve(import.meta.dir, "../docs/plans/electrobun-rebuild")
const DONE_FILE = resolve(DIR, "DONE")

const done = new Set(
	existsSync(DONE_FILE)
		? readFileSync(DONE_FILE, "utf8").split("\n").map((l) => l.trim()).filter(Boolean)
		: [],
)

type Ticket = { id: string; title: string; blocked: string[]; wave: string }
const tickets: Ticket[] = readdirSync(DIR)
	.filter((f) => /^AC-\d+\.md$/.test(f))
	.map((f) => {
		const text = readFileSync(resolve(DIR, f), "utf8")
		const field = (name: string) => new RegExp(`^${name}:\\s*(.*)$`, "m").exec(text)?.[1]?.trim() ?? ""
		const raw = field("blocked_by").replace(/[[\]]/g, "").trim()
		return {
			id: f.replace(".md", ""),
			title: (field("title") || "").replace(/^"|"$/g, ""),
			wave: field("wave").replace(/^"|"$/g, ""),
			blocked: raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : [],
		}
	})
	.sort((a, b) => a.id.localeCompare(b.id))

const ready = tickets.filter((t) => !done.has(t.id) && t.blocked.every((b) => done.has(b)))
const waiting = tickets.filter((t) => !done.has(t.id) && !t.blocked.every((b) => done.has(b)))

console.log(`done: ${done.size}/${tickets.length}`)
console.log(`\nREADY TO DISPATCH (${ready.length}) — all lanes can run at once:`)
for (const t of ready) console.log(`  ${t.id}  ${t.title.replace(/^AC-\d+:\s*/, "")}`)
console.log(`\nblocked (${waiting.length}):`)
for (const t of waiting) {
	const missing = t.blocked.filter((b) => !done.has(b))
	console.log(`  ${t.id}  waits on ${missing.join(", ")}`)
}

// Longest remaining dependency chain, which is what actually bounds wall clock.
const byId = new Map(tickets.map((t) => [t.id, t]))
const memo = new Map<string, string[]>()
function chain(id: string): string[] {
	if (done.has(id)) return []
	const cached = memo.get(id)
	if (cached) return cached
	memo.set(id, [id])
	const t = byId.get(id)
	let longest: string[] = []
	for (const b of t?.blocked ?? []) {
		const c = chain(b)
		if (c.length > longest.length) longest = c
	}
	const result = [...longest, id]
	memo.set(id, result)
	return result
}
let critical: string[] = []
for (const t of tickets) {
	const c = chain(t.id)
	if (c.length > critical.length) critical = c
}
console.log(`\nCRITICAL PATH (${critical.length} deep) — this bounds the wall clock:`)
console.log(`  ${critical.join(" -> ")}`)
