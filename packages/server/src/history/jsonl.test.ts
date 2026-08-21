import * as Vitest from "@effect/vitest"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { decodeJsonl } from "./jsonl.ts"

const Line = Schema.Struct({
	role: Schema.String,
	text: Schema.String
})

Vitest.describe("decodeJsonl", () => {
	Vitest.it.effect("decodes provider JSONL rows with Effect Schema", () =>
		Effect.gen(function*() {
			const decoded = yield* decodeJsonl(
				Line,
				'{"role":"user","text":"Hello"}\n{"role":"assistant","text":"Hi"}\n',
				"/tmp/session.jsonl"
			)
			Vitest.assert.strictEqual(decoded.rows.length, 2)
			Vitest.assert.strictEqual(decoded.rows[0]?.role, "user")
			Vitest.assert.strictEqual(decoded.rows[0]?.text, "Hello")
			Vitest.assert.strictEqual(decoded.rows[1]?.role, "assistant")
			Vitest.assert.strictEqual(decoded.warnings.length, 0)
		})
	)

	Vitest.it.effect("skips empty lines without a warning", () =>
		Effect.gen(function*() {
			const decoded = yield* decodeJsonl(
				Line,
				'\n{"role":"user","text":"Hello"}\n\n',
				"/tmp/session.jsonl"
			)
			Vitest.assert.strictEqual(decoded.rows.length, 1)
			Vitest.assert.strictEqual(decoded.warnings.length, 0)
		})
	)

	Vitest.it.effect("skips malformed lines with a typed warning and does not crash", () =>
		Effect.gen(function*() {
			const decoded = yield* decodeJsonl(
				Line,
				'{"role":"user","text":"keep"}\nnot-json\n{"role":"assistant"}\n{"role":"assistant","text":"ok"}\n',
				"/tmp/session.jsonl"
			)
			Vitest.assert.strictEqual(decoded.rows.length, 2)
			Vitest.assert.strictEqual(decoded.rows[0]?.text, "keep")
			Vitest.assert.strictEqual(decoded.rows[1]?.text, "ok")
			Vitest.assert.strictEqual(decoded.warnings.length, 2)
			Vitest.assert.strictEqual(decoded.warnings[0]?._tag, "HistoryMalformedLineWarning")
			Vitest.assert.strictEqual(decoded.warnings[0]?.lineNumber, 2)
			Vitest.assert.strictEqual(decoded.warnings[0]?.path, "/tmp/session.jsonl")
			Vitest.assert.strictEqual(decoded.warnings[1]?.lineNumber, 3)
			const reasons = Arr.map(decoded.warnings, (warning) => warning.reason)
			Vitest.assert.isTrue(reasons[0]?.length !== undefined && reasons[0].length > 0)
		})
	)
})
