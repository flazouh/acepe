#!/usr/bin/env bun
/**
 * Resolves the recurring three-file conflict that every migration-adding lane
 * produces: Migrations.ts, Migrations.test.ts, and packages/server/package.json.
 *
 * All three conflicts are unions — both sides add a distinct migration or export.
 * Taking the union of the conflicting lines, deduped and ordered, is always the
 * correct resolution here. Anything that is NOT a clean union is left alone and
 * reported, so a real semantic conflict still gets human eyes.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { execSync } from "node:child_process"

const CONFLICT = /<<<<<<< [^\n]*\n([\s\S]*?)=======\n([\s\S]*?)>>>>>>> [^\n]*\n/

/**
 * Resolve one conflict block as the union of both sides.
 *
 * Whether the union's last entry needs a trailing comma cannot be guessed from
 * the block alone: the block is sometimes the tail of its container and
 * sometimes has entries after it. Decide by looking at the next non-empty line
 * in the file. A line that closes the container means no trailing comma.
 */
function resolveOnce(text: string): string | null {
	const match = CONFLICT.exec(text)
	if (!match) return null
	const [whole, ours, theirs] = match
	const rest = text.slice(match.index + whole.length)
	const nextLine = rest.split("\n").find((l) => l.trim() !== "")?.trim() ?? ""
	const closesContainer = /^[}\])]/.test(nextLine)

	const lines = [...ours.split("\n"), ...theirs.split("\n")].filter((l) => l.trim() !== "")
	// Both sides can be a single tail entry with no comma, so the block alone is
	// not enough. The line before the block tells us whether we are inside a
	// comma-separated list at all.
	const beforeLines = text.slice(0, match.index).split("\n").filter((l) => l.trim() !== "")
	const prevLine = beforeLines[beforeLines.length - 1] ?? ""
	const commaSeparated = lines.some((l) => /,\s*$/.test(l)) || /,\s*$/.test(prevLine)

	const seen = new Set<string>()
	const union: string[] = []
	for (const line of lines) {
		const bare = line.replace(/,\s*$/, "")
		if (seen.has(bare.trim())) continue
		seen.add(bare.trim())
		union.push(bare)
	}

	const body = commaSeparated
		? union.map((l, i) => (i < union.length - 1 || !closesContainer ? `${l},` : l)).join("\n")
		: union.join("\n")

	return text.slice(0, match.index) + body + "\n" + rest
}

// Only these files are reliably union-shaped. Anything else — bootstrap.ts,
// source modules with nested structures — must be resolved by hand, because a
// blind union produces syntactically valid-looking nonsense.
const UNION_SAFE = new Set([
	"packages/server/package.json",
	"packages/server/src/persistence/Migrations.ts",
	"packages/server/src/persistence/Migrations.test.ts",
])

const allConflicted = execSync("/usr/bin/git diff --name-only --diff-filter=U", { encoding: "utf8" })
	.split("\n")
	.map((l) => l.trim())
	.filter(Boolean)

const conflicted = allConflicted.filter((f) => UNION_SAFE.has(f))
const handOnly = allConflicted.filter((f) => !UNION_SAFE.has(f))

if (conflicted.length === 0) {
	console.log("resolve-migration-merge: no conflicted files.")
	process.exit(0)
}

const resolved: string[] = []
const skipped: string[] = []

for (const file of conflicted) {
	const before = readFileSync(file, "utf8")
	let after = before
	for (;;) {
		const next = resolveOnce(after)
		if (next === null) break
		after = next
	}
	if (after.includes("<<<<<<<") || after === before) {
		skipped.push(file)
		continue
	}
	writeFileSync(file, after)
	resolved.push(file)
}

for (const f of resolved) console.log(`union-resolved: ${f}`)
for (const f of skipped) console.log(`LEFT FOR YOU: ${f}`)

for (const f of handOnly) console.log(`NOT union-safe, resolve by hand: ${f}`)

if (handOnly.length > 0) {
	console.error(`\n${handOnly.length} file(s) are outside the union-safe list. Resolve them by hand.`)
	process.exit(1)
}

if (skipped.length > 0) {
	console.error(`\n${skipped.length} file(s) were not clean unions. Resolve them by hand.`)
	process.exit(1)
}
console.log(`\nResolved ${resolved.length} file(s). Verify, then commit.`)
