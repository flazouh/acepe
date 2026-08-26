import * as Vitest from "@effect/vitest"
import * as Option from "effect/Option"
import {
	applyOptional,
	arrayField,
	booleanField,
	jsonObjectOf,
	numberField,
	numberFieldAny,
	objectField,
	stringArrayField,
	stringField,
	stringFieldAny
} from "./Json.ts"

const record = {
	name: "read",
	blank: "   ",
	count: 3,
	zero: 0,
	flag: false,
	nested: { path: "/tmp/a" },
	items: ["a", "", "b", 7],
	nothing: null
}

Vitest.describe("Json accessors", () => {
	Vitest.it("reads a non-empty string and treats a blank one as absent", () => {
		Vitest.assert.deepStrictEqual(stringField(record, "name"), Option.some("read"))
		Vitest.assert.deepStrictEqual(stringField(record, "blank"), Option.none())
		Vitest.assert.deepStrictEqual(stringField(record, "missing"), Option.none())
		Vitest.assert.deepStrictEqual(stringField(record, "count"), Option.none())
	})

	Vitest.it("takes the first key that carries a value", () => {
		Vitest.assert.deepStrictEqual(stringFieldAny(record, ["blank", "name"]), Option.some("read"))
		Vitest.assert.deepStrictEqual(numberFieldAny(record, ["missing", "count"]), Option.some(3))
		Vitest.assert.deepStrictEqual(stringFieldAny(record, ["missing"]), Option.none())
	})

	Vitest.it("keeps a zero number and a false boolean", () => {
		Vitest.assert.deepStrictEqual(numberField(record, "zero"), Option.some(0))
		Vitest.assert.deepStrictEqual(booleanField(record, "flag"), Option.some(false))
	})

	Vitest.it("reads nested objects and arrays", () => {
		Vitest.assert.deepStrictEqual(objectField(record, "nested"), Option.some({ path: "/tmp/a" }))
		Vitest.assert.deepStrictEqual(objectField(record, "name"), Option.none())
		Vitest.assert.deepStrictEqual(arrayField(record, "items"), Option.some(["a", "", "b", 7]))
		Vitest.assert.deepStrictEqual(arrayField(record, "nested"), Option.none())
	})

	Vitest.it("keeps only the non-blank strings of an array", () => {
		Vitest.assert.deepStrictEqual(stringArrayField(record, "items"), ["a", "b"])
		Vitest.assert.deepStrictEqual(stringArrayField(record, "missing"), [])
	})

	Vitest.it("rejects a value that is not an object", () => {
		Vitest.assert.deepStrictEqual(jsonObjectOf({ a: 1 }), Option.some({ a: 1 }))
		Vitest.assert.deepStrictEqual(jsonObjectOf("a"), Option.none())
		Vitest.assert.deepStrictEqual(jsonObjectOf(null), Option.none())
		Vitest.assert.deepStrictEqual(jsonObjectOf(["a"]), Option.none())
	})

	Vitest.it("applies an override only when the value is present", () => {
		const add = (total: number, next: number) => total + next
		Vitest.assert.strictEqual(applyOptional(1, 2, add), 3)
		Vitest.assert.strictEqual(applyOptional(1, undefined, add), 1)
		Vitest.assert.strictEqual(applyOptional(1, 0, add), 1)
	})
})
