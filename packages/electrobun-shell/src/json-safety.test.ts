import { describe, expect, it } from "bun:test"
import { describeJsonSafety } from "./json-safety.ts"

describe("describeJsonSafety", () => {
	it("marks a plain event-shaped object safe and reports its JSON length", () => {
		const payload = { type: "TokenAppended", sequence: 12, token: "hi" }
		const result = describeJsonSafety(payload)
		expect(result.jsonSafe).toBe(true)
		expect(result.jsonLength).toBe(JSON.stringify(payload).length)
	})

	it("marks a circular object unsafe", () => {
		const payload: { self?: unknown } = {}
		payload.self = payload
		expect(describeJsonSafety(payload)).toEqual({ jsonSafe: false, jsonLength: -1 })
	})

	it("marks a bigint field unsafe", () => {
		const payload = { count: 10n }
		expect(describeJsonSafety(payload)).toEqual({ jsonSafe: false, jsonLength: -1 })
	})

	it("marks bare undefined unsafe (JSON.stringify returns undefined, not a string)", () => {
		expect(describeJsonSafety(undefined)).toEqual({ jsonSafe: false, jsonLength: -1 })
	})

	it("marks a bare function unsafe", () => {
		expect(describeJsonSafety(() => undefined)).toEqual({ jsonSafe: false, jsonLength: -1 })
	})

	it("marks a large but well-formed payload safe", () => {
		const payload = { chunk: "x".repeat(5_000_000) }
		const result = describeJsonSafety(payload)
		expect(result.jsonSafe).toBe(true)
		expect(result.jsonLength).toBeGreaterThan(5_000_000)
	})
})
