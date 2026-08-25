import { expect, test } from "bun:test"

import { resolvePageZoomLevel } from "./page-zoom.ts"

test("resolvePageZoomLevel reads a positive finite level off the request", () => {
	expect(resolvePageZoomLevel({ level: 1.2 })).toBe(1.2)
	expect(resolvePageZoomLevel({ level: 1 })).toBe(1)
})

test("resolvePageZoomLevel rejects anything that is not a usable level", () => {
	expect(resolvePageZoomLevel({ level: 0 })).toBeNull()
	expect(resolvePageZoomLevel({ level: -1 })).toBeNull()
	expect(resolvePageZoomLevel({ level: Number.NaN })).toBeNull()
	expect(resolvePageZoomLevel({ level: Number.POSITIVE_INFINITY })).toBeNull()
	expect(resolvePageZoomLevel({ level: "1.2" })).toBeNull()
	expect(resolvePageZoomLevel({})).toBeNull()
	expect(resolvePageZoomLevel(null)).toBeNull()
	expect(resolvePageZoomLevel(undefined)).toBeNull()
	expect(resolvePageZoomLevel(1.2)).toBeNull()
})
