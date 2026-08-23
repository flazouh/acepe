import { describe, expect, it } from "bun:test"

import { hunkButtonsVisible, selectedReviewFile } from "./index.js"

describe("review-modal exports", () => {
	it("exports hunk helpers", () => {
		expect(hunkButtonsVisible({ index: 0, action: null })).toBe(true)
		expect(selectedReviewFile).toBeTypeOf("function")
	})
})
