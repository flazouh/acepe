import { expect, test } from "bun:test"

import { acepeWindowSpec } from "./window-spec.ts"

test("shell window loads the svelte bundle over views://", () => {
	expect(acepeWindowSpec.url).toBe("views://mainview/")
})

test("shell window matches the Acepe frame size", () => {
	expect(acepeWindowSpec.title).toBe("Acepe")
	expect(acepeWindowSpec.frame.width).toBe(1512)
	expect(acepeWindowSpec.frame.height).toBe(982)
})

test("shell window asks the host to activate a visible app window", () => {
	expect(acepeWindowSpec.activate).toBe(true)
	expect(acepeWindowSpec.hidden).toBe(false)
})
