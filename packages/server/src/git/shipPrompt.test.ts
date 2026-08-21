import * as Vitest from "@effect/vitest"
import {
	ACEPE_PR_FOOTER,
	buildShipPrompt,
	DEFAULT_SHIP_INSTRUCTIONS,
	LEGACY_DEFAULT_SHIP_INSTRUCTIONS,
	normalizeCustomInstructions,
	prBodyWithAcepeFooter
} from "./shipPrompt.ts"

Vitest.describe("normalizeCustomInstructions", () => {
	Vitest.it("ignores empty, current default, and legacy default instructions", () => {
		Vitest.assert.strictEqual(normalizeCustomInstructions(undefined), undefined)
		Vitest.assert.strictEqual(normalizeCustomInstructions("   "), undefined)
		Vitest.assert.strictEqual(normalizeCustomInstructions(DEFAULT_SHIP_INSTRUCTIONS), undefined)
		Vitest.assert.strictEqual(
			normalizeCustomInstructions(LEGACY_DEFAULT_SHIP_INSTRUCTIONS),
			undefined
		)
		Vitest.assert.strictEqual(
			normalizeCustomInstructions("Custom reviewer guidance"),
			"Custom reviewer guidance"
		)
	})
})

Vitest.describe("buildShipPrompt", () => {
	Vitest.it("keeps the hidden XML contract and branch context", () => {
		const prompt = buildShipPrompt(
			"feature/default",
			"M\tsrc/lib.rs",
			"diff --git a/src/lib.rs b/src/lib.rs",
			undefined
		)
		Vitest.assert.strictEqual(prompt.startsWith(DEFAULT_SHIP_INSTRUCTIONS), true)
		Vitest.assert.strictEqual(prompt.includes("Respond in this EXACT XML format"), true)
		Vitest.assert.strictEqual(prompt.includes("Current branch: feature/default"), true)
		Vitest.assert.strictEqual(prompt.includes("Diff:\ndiff --git a/src/lib.rs b/src/lib.rs"), true)
	})

	Vitest.it("replaces only the editable instructions when custom text is set", () => {
		const prompt = buildShipPrompt(
			"feature/custom",
			"M\tsrc/lib.rs",
			"diff --git a/src/lib.rs b/src/lib.rs",
			"Custom ship instructions"
		)
		Vitest.assert.strictEqual(prompt.startsWith("Custom ship instructions"), true)
		Vitest.assert.strictEqual(prompt.includes(DEFAULT_SHIP_INSTRUCTIONS), false)
		Vitest.assert.strictEqual(prompt.includes("<ship>"), true)
	})
})

Vitest.describe("prBodyWithAcepeFooter", () => {
	Vitest.it("appends the Acepe badge footer", () => {
		Vitest.assert.strictEqual(prBodyWithAcepeFooter(undefined).includes("Created with Acepe"), true)
		Vitest.assert.strictEqual(
			prBodyWithAcepeFooter("Hello"),
			`Hello${ACEPE_PR_FOOTER}`
		)
	})
})
