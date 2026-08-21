import * as Vitest from "@effect/vitest"
import * as Option from "effect/Option"
import { isMcpSlashCommand, parseMcpSlashServerName } from "./slash.ts"

Vitest.describe("parseMcpSlashServerName", () => {
	Vitest.it("reads the server name from an mcp slash command", () => {
		const parsed = parseMcpSlashServerName("mcp:github")
		Vitest.assert.strictEqual(Option.isSome(parsed), true)
		if (Option.isSome(parsed)) {
			Vitest.assert.strictEqual(parsed.value, "github")
		}
	})

	Vitest.it("uses the first segment after mcp:", () => {
		const parsed = parseMcpSlashServerName("mcp:github:search")
		Vitest.assert.strictEqual(Option.isSome(parsed), true)
		if (Option.isSome(parsed)) {
			Vitest.assert.strictEqual(parsed.value, "github")
		}
	})

	Vitest.it("rejects empty and non-mcp names", () => {
		Vitest.assert.strictEqual(Option.isNone(parseMcpSlashServerName("mcp:")), true)
		Vitest.assert.strictEqual(Option.isNone(parseMcpSlashServerName("compact")), true)
		Vitest.assert.strictEqual(isMcpSlashCommand("mcp:linear"), true)
		Vitest.assert.strictEqual(isMcpSlashCommand("compact"), false)
	})
})
