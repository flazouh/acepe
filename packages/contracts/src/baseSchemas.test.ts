import { describe, expect, it } from "bun:test"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"

import { IsoDateTime, JsonObject, Sequence, TrimmedNonEmptyString } from "./baseSchemas.ts"

describe("TrimmedNonEmptyString", () => {
	it("decodes a non-empty string", () => {
		expect(Option.getOrUndefined(Schema.decodeUnknownOption(TrimmedNonEmptyString)("Acepe"))).toBe(
			"Acepe",
		)
	})

	it("trims padding", () => {
		expect(
			Option.getOrUndefined(Schema.decodeUnknownOption(TrimmedNonEmptyString)("  Acepe  ")),
		).toBe("Acepe")
	})

	it("rejects an empty string", () => {
		expect(Option.isNone(Schema.decodeUnknownOption(TrimmedNonEmptyString)(""))).toBe(true)
	})
})

describe("IsoDateTime", () => {
	it("decodes an ISO-8601 date-time string", () => {
		expect(
			Option.getOrUndefined(Schema.decodeUnknownOption(IsoDateTime)("2026-08-20T12:00:00.000Z")),
		).toBe("2026-08-20T12:00:00.000Z")
	})

	it("rejects a string that is not a date-time", () => {
		expect(Option.isNone(Schema.decodeUnknownOption(IsoDateTime)("not-a-date"))).toBe(true)
	})

	it("rejects a non-string", () => {
		expect(Option.isNone(Schema.decodeUnknownOption(IsoDateTime)(1))).toBe(true)
	})
})

describe("Sequence", () => {
	it("decodes a non-negative integer", () => {
		expect(Option.getOrUndefined(Schema.decodeUnknownOption(Sequence)(0))).toBe(0)
		expect(Option.getOrUndefined(Schema.decodeUnknownOption(Sequence)(7))).toBe(7)
	})

	it("rejects a negative integer", () => {
		expect(Option.isNone(Schema.decodeUnknownOption(Sequence)(-1))).toBe(true)
	})

	it("rejects a non-integer", () => {
		expect(Option.isNone(Schema.decodeUnknownOption(Sequence)(1.5))).toBe(true)
	})
})

describe("JsonObject", () => {
	it("decodes a JSON object", () => {
		expect(
			Option.getOrUndefined(Schema.decodeUnknownOption(JsonObject)({ key: [1, true, null] })),
		).toEqual({ key: [1, true, null] })
	})

	it("rejects a JSON array", () => {
		expect(Option.isNone(Schema.decodeUnknownOption(JsonObject)([1, 2, 3]))).toBe(true)
	})

	it("rejects a primitive", () => {
		expect(Option.isNone(Schema.decodeUnknownOption(JsonObject)("x"))).toBe(true)
		expect(Option.isNone(Schema.decodeUnknownOption(JsonObject)(null))).toBe(true)
	})
})
