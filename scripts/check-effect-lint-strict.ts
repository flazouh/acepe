#!/usr/bin/env bun
/**
 * Guards the Effect lint configuration.
 *
 * Every diagnostic that `@effect/language-service` ships must be listed in
 * tsconfig.base.json with severity "error". This fails when a rule is dropped,
 * downgraded, or newly added by a package upgrade, so upgrades cannot silently
 * weaken the lint.
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const ROOT = resolve(import.meta.dir, "..")
const BUNDLE = resolve(ROOT, "node_modules/@effect/language-service/index.js")
const TSCONFIG = resolve(ROOT, "tsconfig.base.json")

function shippedRules(): Set<string> {
	const source = readFileSync(BUNDLE, "utf8")
	const names = new Set<string>()
	for (const match of source.matchAll(/createDiagnostic\(\{/g)) {
		const window = source.slice(match.index, match.index + 900)
		const name = /\bname:\s*"([A-Za-z0-9]+)"/.exec(window)
		if (name) names.add(name[1])
	}
	return names
}

function configuredRules(): Record<string, string> {
	const config = JSON.parse(readFileSync(TSCONFIG, "utf8"))
	const plugin = config.compilerOptions?.plugins?.find(
		(entry: { name?: string }) => entry.name === "@effect/language-service",
	)
	if (!plugin) throw new Error("tsconfig.base.json has no @effect/language-service plugin")
	return plugin.diagnosticSeverity ?? {}
}

const shipped = shippedRules()
const configured = configuredRules()

if (shipped.size === 0) {
	console.error("check-effect-lint-strict: found no diagnostics in the language-service bundle.")
	console.error("The bundle format probably changed. Update this script before trusting the lint.")
	process.exit(1)
}

const missing = [...shipped].filter((rule) => !(rule in configured)).sort()
const notError = Object.entries(configured)
	.filter(([, severity]) => severity !== "error")
	.map(([rule, severity]) => `${rule} = "${severity}"`)
	.sort()
const unknown = Object.keys(configured)
	.filter((rule) => !shipped.has(rule))
	.sort()

const problems: string[] = []
if (missing.length > 0) problems.push(`missing from tsconfig.base.json:\n  ${missing.join("\n  ")}`)
if (notError.length > 0) problems.push(`not set to "error":\n  ${notError.join("\n  ")}`)
if (unknown.length > 0) problems.push(`configured but not shipped by the package:\n  ${unknown.join("\n  ")}`)

if (problems.length > 0) {
	console.error(`check-effect-lint-strict: Effect lint is not fully strict.\n`)
	for (const problem of problems) console.error(`${problem}\n`)
	console.error(`Set every rule to "error" in tsconfig.base.json, then run this again.`)
	process.exit(1)
}

console.log(`check-effect-lint-strict: ${shipped.size} Effect diagnostics, all set to "error".`)
