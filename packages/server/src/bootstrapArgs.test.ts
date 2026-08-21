import * as Vitest from "@effect/vitest"
import * as Duration from "effect/Duration"
import * as Option from "effect/Option"
import { parseBootstrapArgs } from "./bootstrapArgs.ts"

Vitest.describe("parseBootstrapArgs", () => {
	Vitest.it("defaults to no stdio, no db path, and zero token delay", () => {
		const parsed = parseBootstrapArgs([])
		Vitest.assert.isFalse(parsed.stdio)
		Vitest.assert.isTrue(Option.isNone(parsed.dbFilename))
		Vitest.assert.strictEqual(Duration.toMillis(parsed.tokenDelay), 0)
	})

	Vitest.it("reads --stdio, --db, and --token-delay", () => {
		const parsed = parseBootstrapArgs([
			"--stdio",
			"--db",
			"/tmp/acepe.db",
			"--token-delay",
			"80"
		])
		Vitest.assert.isTrue(parsed.stdio)
		Vitest.assert.deepStrictEqual(parsed.dbFilename, Option.some("/tmp/acepe.db"))
		Vitest.assert.strictEqual(Duration.toMillis(parsed.tokenDelay), 80)
	})

	Vitest.it("ignores a missing or non-positive token delay", () => {
		const missing = parseBootstrapArgs(["--token-delay"])
		const zero = parseBootstrapArgs(["--token-delay", "0"])
		const flag = parseBootstrapArgs(["--token-delay", "--stdio"])
		Vitest.assert.strictEqual(Duration.toMillis(missing.tokenDelay), 0)
		Vitest.assert.strictEqual(Duration.toMillis(zero.tokenDelay), 0)
		Vitest.assert.strictEqual(Duration.toMillis(flag.tokenDelay), 0)
		Vitest.assert.isTrue(flag.stdio)
	})
})
