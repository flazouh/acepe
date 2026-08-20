import * as Vitest from "@effect/vitest"
import * as Data from "effect/Data"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"

import { decodeUnknown } from "./decodeUnknown.ts"

class ParseFailed extends Data.TaggedError("ParseFailed")<{
	readonly message: string
}> {}

const Name = Schema.Struct({
	name: Schema.String
})

const decodeName = decodeUnknown(
	Name,
	(error) => new ParseFailed({ message: error.message })
)

Vitest.describe("decodeUnknown", () => {
	Vitest.it("succeeds for a matching payload", () => {
		const decoded = decodeName({ name: "Acepe" })
		Vitest.assert.isTrue(Result.isSuccess(decoded))
		if (Result.isSuccess(decoded)) {
			Vitest.assert.deepStrictEqual(decoded.success, { name: "Acepe" })
		}
	})

	Vitest.it("fails for a mismatched payload", () => {
		const decoded = decodeName({ name: 1 })
		Vitest.assert.isTrue(Result.isFailure(decoded))
		if (Result.isFailure(decoded)) {
			Vitest.assert.strictEqual(decoded.failure._tag, "ParseFailed")
		}
	})
})
