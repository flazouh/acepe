import { describe, expect, it } from "bun:test"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Schema from "effect/Schema"

import { defaultProjectColor, PROJECT_COLORS, ProjectColor } from "./projectColor.ts"

const decode = Schema.decodeUnknownEffect(ProjectColor)

describe("ProjectColor", () => {
	it("accepts every name in the palette", () => {
		for (const color of PROJECT_COLORS) {
			expect(Exit.isSuccess(Effect.runSyncExit(decode(color)))).toBe(true)
		}
	})

	it("rejects a hex value", () => {
		expect(Exit.isFailure(Effect.runSyncExit(decode("#FF5D5A")))).toBe(true)
	})

	it("rejects a name outside the palette", () => {
		expect(Exit.isFailure(Effect.runSyncExit(decode("chartreuse")))).toBe(true)
	})
})

describe("defaultProjectColor", () => {
	it("returns the same color for the same workspace root", () => {
		expect(defaultProjectColor("/repo/acepe")).toBe(defaultProjectColor("/repo/acepe"))
	})

	it("gives two checkouts of the same repository different colors", () => {
		expect(defaultProjectColor("/repo/acepe")).not.toBe(defaultProjectColor("/worktrees/acepe"))
	})

	it("always returns a name in the palette", () => {
		const roots = ["", "/", "/a", "/tmp/acepe", "/Users/alex/Documents/acepe"]
		for (const root of roots) {
			expect(PROJECT_COLORS).toContain(defaultProjectColor(root))
		}
	})
})
