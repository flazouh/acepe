import { describe, expect, it } from "bun:test"

import { canDecreaseFont, canIncreaseFont } from "./index.js"

describe("settings-modal exports", () => {
	it("exports the font stepper helpers", () => {
		expect(canDecreaseFont(13, 12)).toBe(true)
		expect(canIncreaseFont(19, 20)).toBe(true)
	})
})
