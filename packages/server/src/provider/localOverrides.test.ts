import * as Vitest from "@effect/vitest"
import * as Arr from "effect/Array"
import { defaultLocalOverrides } from "./localOverrides.ts"

const overrideIds = ["claude-code", "copilot", "codex"] as const

Vitest.describe("defaultLocalOverrides", () => {
	Vitest.it("keeps a local override entry for each Acepe agent id the ACP registry does not use", () => {
		const ids = Arr.map(defaultLocalOverrides, (agent) => agent.id)
		Vitest.assert.deepStrictEqual(ids, Arr.fromIterable(overrideIds))
		Vitest.assert.strictEqual(
			Arr.every(defaultLocalOverrides, (agent) => agent.distribution.binary === undefined),
			true
		)
	})
})
