#!/usr/bin/env bun
/**
 * Guards migration numbering across parallel lanes.
 *
 * The Effect SQL migrator skips any migration whose id is <= the highest id
 * already applied (Migrator.ts: `if (currentId <= latestMigrationId) continue`).
 * It does NOT track applied names. So if lane B lands 0004 before lane A lands
 * 0003, migration 0003 is skipped forever on every database that ran 0004 —
 * silently, with no error and no missing-table warning.
 *
 * This fails the build when registered migration ids are not contiguous from 1,
 * which forces a renumber at merge time instead of a silent data loss later.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs"
import { resolve } from "node:path"

const ROOT = process.argv[2] ?? resolve(import.meta.dir, "..")
const SERVER = resolve(ROOT, "packages/server/src/persistence")
const REGISTRY = resolve(SERVER, "Migrations.ts")
const DIR = resolve(SERVER, "Migrations")

if (!existsSync(REGISTRY)) {
	console.log("check-migration-ids: no migration registry yet, nothing to check.")
	process.exit(0)
}

const registry = readFileSync(REGISTRY, "utf8")
const registered = [...registry.matchAll(/"(\d{4})_([a-z0-9_]+)"\s*:/g)].map((m) => ({
	id: Number(m[1]),
	name: `${m[1]}_${m[2]}`,
}))
const onDisk = readdirSync(DIR)
	.filter((f) => /^\d{4}_[a-z0-9_]+\.ts$/.test(f) && !f.endsWith(".test.ts"))
	.map((f) => f.replace(".ts", ""))
	.sort()

const problems: string[] = []

const ids = registered.map((r) => r.id).sort((a, b) => a - b)
for (const [index, id] of ids.entries()) {
	if (id !== index + 1) {
		problems.push(
			`ids are not contiguous from 1: got [${ids.join(", ")}].\n` +
				`  A gap means a lane merged out of order. Renumber so the sequence has no hole,\n` +
				`  because the migrator silently skips any id below the highest already applied.`,
		)
		break
	}
}

if (new Set(ids).size !== ids.length) problems.push(`duplicate migration ids: [${ids.join(", ")}]`)

const registeredNames = new Set(registered.map((r) => r.name))
const orphans = onDisk.filter((f) => !registeredNames.has(f))
if (orphans.length > 0) {
	problems.push(`on disk but not registered in Migrations.ts:\n  ${orphans.join("\n  ")}`)
}
const missing = registered.filter((r) => !onDisk.includes(r.name)).map((r) => r.name)
if (missing.length > 0) problems.push(`registered but missing on disk:\n  ${missing.join("\n  ")}`)

if (problems.length > 0) {
	console.error("check-migration-ids: migration numbering is unsafe.\n")
	for (const p of problems) console.error(`${p}\n`)
	process.exit(1)
}

console.log(`check-migration-ids: ${ids.length} migrations, contiguous 1..${ids.length}, all registered.`)
