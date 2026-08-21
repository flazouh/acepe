import * as Vitest from "@effect/vitest"
import { gradeExchange } from "./grade.ts"
import { formatReport, makeReport } from "./report.ts"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"

const json = (value: Schema.Json): Schema.Json => value

const sampleExpected = {
	recordedAt: "2026-08-17T08:55:01.034Z",
	command: "acp_new_session",
	payload: json({ cwd: "/tmp" }),
	response: json({ jsonrpc: "2.0", id: 1, result: { ok: true } }),
	notifications: Arr.empty<Schema.Json>(),
}

Vitest.describe("makeReport", () => {
	Vitest.it("counts pass, fail, and skipped and keeps the first divergence", () => {
		const pass = gradeExchange(
			0,
			sampleExpected,
			Option.some({
				command: "acp_new_session",
				payload: sampleExpected.payload,
				response: sampleExpected.response,
				notifications: Arr.empty(),
			}),
			Arr.empty(),
		)
		const fail = gradeExchange(
			1,
			{
				recordedAt: sampleExpected.recordedAt,
				command: "acp_send_prompt",
				payload: json({ text: "hi" }),
				response: json({ jsonrpc: "2.0", id: 2, result: { ok: true } }),
				notifications: Arr.empty(),
			},
			Option.some({
				command: "acp_send_prompt",
				payload: json({ text: "hi" }),
				response: json({ jsonrpc: "2.0", id: 2, result: { ok: false } }),
				notifications: Arr.empty(),
			}),
			Arr.empty(),
		)
		const skipped = gradeExchange(2, sampleExpected, Option.none(), ["acp_new_session"])
		const report = makeReport("claude-session-reference.ndjson", [pass, fail, skipped])
		Vitest.assert.strictEqual(report.pass, 1)
		Vitest.assert.strictEqual(report.fail, 1)
		Vitest.assert.strictEqual(report.skipped, 1)
		Vitest.assert.isTrue(Option.isSome(report.firstDivergence))
		if (Option.isSome(report.firstDivergence)) {
			Vitest.assert.strictEqual(report.firstDivergence.value.path, "exchanges[1].response.result.ok")
		}
	})
})

Vitest.describe("formatReport", () => {
	Vitest.it.effect("prints counts and the first divergence path", () =>
		Effect.gen(function* () {
			const fail = gradeExchange(
				0,
				sampleExpected,
				Option.some({
					command: "acp_new_session",
					payload: sampleExpected.payload,
					response: json({ jsonrpc: "2.0", id: 1, result: { ok: false } }),
					notifications: Arr.empty(),
				}),
				Arr.empty(),
			)
			const report = makeReport("demo.ndjson", [fail])
			const text = yield* formatReport(report)
			Vitest.assert.isTrue(text.includes("fixture: demo.ndjson"))
			Vitest.assert.isTrue(text.includes("pass: 0"))
			Vitest.assert.isTrue(text.includes("fail: 1"))
			Vitest.assert.isTrue(text.includes("skipped: 0"))
			Vitest.assert.isTrue(text.includes("first divergence: exchanges[0].response.result.ok"))
			Vitest.assert.isTrue(text.includes("expected: true"))
			Vitest.assert.isTrue(text.includes("actual: false"))
		}),
	)
})
