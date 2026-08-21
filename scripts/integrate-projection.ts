#!/usr/bin/env bun
/**
 * Registers a projection lane's projector in bootstrap.ts and backfills no-op
 * handlers wherever the lane's new events broke an exhaustive matcher.
 *
 * Wave 5 lanes cannot edit bootstrap.ts concurrently, so registration is an
 * integrator step. Doing it by hand for every lane is how a projector ends up
 * with a table that silently stays empty.
 *
 * Usage: bun scripts/integrate-projection.ts <ServiceName> [NewEvent ...]
 *   e.g. bun scripts/integrate-projection.ts ProjectionPendingApprovals ApprovalRequested
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { globSync } from "node:fs"

const [service, ...newEvents] = process.argv.slice(2)
if (!service) {
	console.error("usage: integrate-projection.ts <ServiceName> [NewEvent ...]")
	process.exit(1)
}

const BOOTSTRAP = "packages/server/src/bootstrap.ts"
const local = service.charAt(0).toLowerCase() + service.slice(1).replace(/^projection/i, "")
const varName = local.charAt(0).toLowerCase() + local.slice(1)

let s = readFileSync(BOOTSTRAP, "utf8")
if (s.includes(`${service} }`) || s.includes(`${service},`) || s.includes(`* ${service}\n`)) {
	console.log(`${service}: already registered in bootstrap.ts`)
} else {
	const layerImport = `import { ${service}Live } from "./persistence/Layers/${service}.ts"\n`
	const svcImport = `import { ${service} } from "./persistence/Services/${service}.ts"\n`
	s = s.replace(/^(import \{ Projection[A-Za-z]+Live \} from "\.\/persistence\/Layers\/[A-Za-z]+\.ts"\n)/m, layerImport + "$1")
	s = s.replace(/^(import \{ Projection[A-Za-z]+ \} from "\.\/persistence\/Services\/[A-Za-z]+\.ts"\n)/m, svcImport + "$1")

	// add the Live layer to persistenceAt's mergeAll
	// persistenceAt ends with `<LastLive>\n\t).pipe(`; append before that close.
	s = s.replace(/(\n\t\tProjection[A-Za-z]+Live)(\n\t\)\.pipe\()/, `$1,\n\t\t${service}Live$2`)

	// bind the service and append its projector definition
	s = s.replace(/(\n\t\tconst [a-zA-Z]+ = yield\* Projection[A-Za-z]+\n)(?![\s\S]*const [a-zA-Z]+ = yield\* Projection)/, `$1\t\tconst ${varName} = yield* ${service}\n`)
	s = s.replace(/(\t\t\t\{\n\t\t\t\tname: [a-zA-Z]+\.name,\n\t\t\t\tapply: [a-zA-Z]+\.apply,\n\t\t\t\ttruncate: [a-zA-Z]+\.truncate\n\t\t\t\}\n)(\t\t\]\))/,
		`$1\t\t\t,\n\t\t\t{\n\t\t\t\tname: ${varName}.name,\n\t\t\t\tapply: ${varName}.apply,\n\t\t\t\ttruncate: ${varName}.truncate\n\t\t\t}\n$2`)
	writeFileSync(BOOTSTRAP, s)
	console.log(`${service}: registered in bootstrap.ts`)
}

if (newEvents.length > 0) {
	const files = globSync("packages/server/src/**/*.ts")
	let patched = 0
	for (const file of files) {
		let body = readFileSync(file, "utf8")
		if (!body.includes("Match.discriminatorsExhaustive")) continue
		const missing = newEvents.filter((e) => !body.includes(`${e}:`))
		if (missing.length === 0) continue
		const anchor = /\n(\t+)(TurnCancelled|TokenAppended): ([^\n]*)\n/.exec(body)
		if (!anchor) continue
		const indent = anchor[1]
		const line = anchor[0].replace(/\n$/, "").replace(/,?$/, ",")
		const additions = missing.map((e) => `${indent}${e}: () => Effect.succeed(current)`).join(",\n")
		body = body.replace(anchor[0], `${line}\n${additions}\n`)
		writeFileSync(file, body)
		patched += 1
		console.log(`backfilled ${missing.join(", ")} in ${file}`)
	}
	if (patched === 0) console.log("no exhaustive matcher needed backfilling")
}
