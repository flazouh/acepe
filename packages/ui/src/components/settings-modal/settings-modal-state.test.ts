import { describe, expect, it } from "bun:test"

import { canDecreaseFont, canIncreaseFont } from "./settings-modal-state.js"

describe("canDecreaseFont", () => {
	it("is false at the minimum", () => {
		expect(canDecreaseFont(12, 12)).toBe(false)
		expect(canDecreaseFont(13, 12)).toBe(true)
	})
})

describe("canIncreaseFont", () => {
	it("is false at the maximum", () => {
		expect(canIncreaseFont(20, 20)).toBe(false)
		expect(canIncreaseFont(19, 20)).toBe(true)
	})
})
