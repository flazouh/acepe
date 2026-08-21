import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import type { CompletedExchange } from "./correlate.ts"
import { decodeExchangeLine, referenceFixturePath } from "./fixture.ts"
import {
	firstDivergence,
	GENERATED_ID_FIELDS,
	gradeExchange,
	gradeExchanges,
	isGeneratedId,
	isTimestampField,
	NORMALIZATION_RULES,
	normalizeJson,
	TIMESTAMP_FIELDS,
	TIMESTAMP_TOKEN,
} from "./grade.ts"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as Str from "effect/String"

const Platform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer)

const json = (value: Schema.Json): Schema.Json => value

const isJsonArray = Schema.is(Schema.Array(Schema.Json))
const isJsonRecord = Schema.is(Schema.Record(Schema.String, Schema.Json))

const reverseKeys = (value: Schema.Json): Schema.Json => {
	if (isJsonArray(value)) {
		return Arr.map(value, reverseKeys)
	}
	if (isJsonRecord(value)) {
		const keys = Arr.reverse(Object.keys(value))
		const record: Record<string, Schema.Json> = {}
		for (const key of keys) {
			const child = value[key]
			if (child !== undefined) {
				record[key] = reverseKeys(child)
			}
		}
		return record
	}
	return value
}

const sampleResponse = json({
	jsonrpc: "2.0",
	id: 2,
	result: {
		session_id: "81fde13c-1b27-4552-8b90-25b04c88aa50",
		recordedAt: "2026-08-17T08:55:01.034Z",
	},
})

Vitest.describe("NORMALIZATION_RULES", () => {
	Vitest.it("names field order, generated ids, and timestamps", () => {
		Vitest.assert.deepStrictEqual(
			Arr.map(NORMALIZATION_RULES, (rule) => rule.name),
			["field-order", "generated-ids", "timestamps"],
		)
		Vitest.assert.deepStrictEqual([...TIMESTAMP_FIELDS], [
			"createdAt",
			"created_at",
			"recordedAt",
			"timestamp",
			"timestampMs",
			"updatedAt",
			"updated_at",
		])
		Vitest.assert.deepStrictEqual([...GENERATED_ID_FIELDS], [
			"eventId",
			"permissionId",
			"sessionId",
			"session_id",
			"toolCallId",
			"uuid",
		])
		Vitest.assert.isTrue(isTimestampField("timestampMs"))
		Vitest.assert.isFalse(isTimestampField("durationMs"))
		Vitest.assert.isTrue(isGeneratedId("81fde13c-1b27-4552-8b90-25b04c88aa50", undefined))
		Vitest.assert.isTrue(isGeneratedId("toolu_01Rm2cg5PUi3vmEEdNa3Q8cA", undefined))
		Vitest.assert.isTrue(isGeneratedId("perm-toolu_01", undefined))
		Vitest.assert.isTrue(isGeneratedId("custom-session", "sessionId"))
		Vitest.assert.isFalse(isGeneratedId("allow-once", "optionId"))
		Vitest.assert.isFalse(isGeneratedId("allow-once", undefined))
	})
})

Vitest.describe("normalizeJson", () => {
	Vitest.it("sorts object keys and replaces generated ids and timestamps", () => {
		const normalized = normalizeJson(
			json({
				timestampMs: 1786956901034,
				sessionId: "81fde13c-1b27-4552-8b90-25b04c88aa50",
				nested: {
					sessionId: "81fde13c-1b27-4552-8b90-25b04c88aa50",
					toolCallId: "toolu_01Rm2cg5PUi3vmEEdNa3Q8cA",
				},
				ok: true,
				when: "2026-08-17T08:55:01.034Z",
			}),
		)
		Vitest.assert.deepStrictEqual(normalized, {
			nested: {
				sessionId: "<id:1>",
				toolCallId: "<id:2>",
			},
			ok: true,
			sessionId: "<id:1>",
			timestampMs: TIMESTAMP_TOKEN,
			when: TIMESTAMP_TOKEN,
		})
		Vitest.assert.deepStrictEqual(Object.keys(normalized as Schema.JsonObject), [
			"nested",
			"ok",
			"sessionId",
			"timestampMs",
			"when",
		])
	})

	Vitest.it("keeps jsonrpc numeric ids and stable enums", () => {
		Vitest.assert.deepStrictEqual(
			normalizeJson(
				json({
					jsonrpc: "2.0",
					id: 4,
					result: { optionId: "allow-once" },
				}),
			),
			{
				id: 4,
				jsonrpc: "2.0",
				result: { optionId: "allow-once" },
			},
		)
	})
})

Vitest.describe("firstDivergence", () => {
	Vitest.it("ignores field order after normalisation", () => {
		const left = json({ b: 1, a: "81fde13c-1b27-4552-8b90-25b04c88aa50" })
		const right = json({ a: "66affa11-28c2-4bc6-bd47-ceb539aacda7", b: 1 })
		Vitest.assert.deepStrictEqual(firstDivergence(left, right, "response"), Option.none())
	})

	Vitest.it("reports the first unexplained path", () => {
		const expected = json({ result: { ok: true, n: 1 } })
		const actual = json({ result: { ok: false, n: 1 } })
		const divergence = firstDivergence(expected, actual, "exchanges[0].response")
		Vitest.assert.isTrue(Option.isSome(divergence))
		if (Option.isSome(divergence)) {
			Vitest.assert.strictEqual(divergence.value.path, "exchanges[0].response.result.ok")
			Vitest.assert.deepStrictEqual(divergence.value.expected, Option.some(true))
			Vitest.assert.deepStrictEqual(divergence.value.actual, Option.some(false))
		}
	})

	Vitest.it("reports a missing field as unexplained", () => {
		const divergence = firstDivergence(json({ a: 1, b: 2 }), json({ a: 1 }), "response")
		Vitest.assert.isTrue(Option.isSome(divergence))
		if (Option.isSome(divergence)) {
			Vitest.assert.strictEqual(divergence.value.path, "response.b")
			Vitest.assert.deepStrictEqual(divergence.value.actual, Option.none())
		}
	})
})

Vitest.describe("gradeExchange", () => {
	const expected = {
		recordedAt: "2026-08-17T08:55:01.034Z",
		command: "acp_new_session",
		payload: json({ cwd: "/tmp", agent_id: "claude" }),
		response: sampleResponse,
		notifications: Arr.empty<Schema.Json>(),
	}

	const actualFrom = (response: Schema.Json, notifications: ReadonlyArray<Schema.Json>): CompletedExchange => ({
		command: "acp_new_session",
		payload: expected.payload,
		response,
		notifications,
	})

	Vitest.it("passes when ids and timestamps differ but meaning matches", () => {
		const actualResponse = json({
			result: {
				recordedAt: "2026-08-21T00:00:00.000Z",
				session_id: "66affa11-28c2-4bc6-bd47-ceb539aacda7",
			},
			id: 2,
			jsonrpc: "2.0",
		})
		const grade = gradeExchange(
			0,
			expected,
			Option.some(actualFrom(reverseKeys(actualResponse), Arr.empty())),
			Arr.empty(),
		)
		Vitest.assert.strictEqual(grade.status, "pass")
		Vitest.assert.deepStrictEqual(grade.divergence, Option.none())
	})

	Vitest.it("fails on an unexplained field and keeps the path", () => {
		const grade = gradeExchange(
			2,
			expected,
			Option.some(
				actualFrom(
					json({
						jsonrpc: "2.0",
						id: 2,
						result: { session_id: "81fde13c-1b27-4552-8b90-25b04c88aa50", extra: true },
					}),
					Arr.empty(),
				),
			),
			Arr.empty(),
		)
		Vitest.assert.strictEqual(grade.status, "fail")
		Vitest.assert.isTrue(Option.isSome(grade.divergence))
		if (Option.isSome(grade.divergence)) {
			Vitest.assert.strictEqual(grade.divergence.value.path, "exchanges[2].response.result.extra")
		}
	})

	Vitest.it("skips listed commands", () => {
		const grade = gradeExchange(1, expected, Option.none(), ["acp_new_session"])
		Vitest.assert.strictEqual(grade.status, "skipped")
		Vitest.assert.isTrue(Option.isSome(grade.skipReason))
	})

	Vitest.it("fails when the implementation sends no response", () => {
		const grade = gradeExchange(0, expected, Option.none(), Arr.empty())
		Vitest.assert.strictEqual(grade.status, "fail")
		if (Option.isSome(grade.divergence)) {
			Vitest.assert.strictEqual(grade.divergence.value.path, "exchanges[0].response")
			Vitest.assert.deepStrictEqual(grade.divergence.value.actual, Option.none())
		}
	})
})

Vitest.layer(Platform)("gradeExchanges", (it) => {
	it.effect("grades the recorded sidecar fixture against itself at 100 percent", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem
			const fixturePath = yield* referenceFixturePath()
			const body = yield* fs.readFileString(fixturePath)
			const lines = yield* Stream.make(body).pipe(
				Stream.splitLines,
				Stream.filter((line) => Str.isNonEmpty(Str.trim(line))),
				Stream.runCollect,
			)
			const exchanges = yield* Effect.forEach(lines, decodeExchangeLine)
			const actuals = Arr.map(exchanges, (exchange) =>
				Option.some<CompletedExchange>({
					command: exchange.command,
					payload: exchange.payload,
					response: reverseKeys(exchange.response),
					notifications: Arr.map(exchange.notifications, reverseKeys),
				}),
			)
			const grades = gradeExchanges(exchanges, actuals, Arr.empty())
			const failed = Arr.filter(grades, (grade) => grade.status === "fail")
			Vitest.assert.strictEqual(failed.length, 0)
			Vitest.assert.strictEqual(Arr.filter(grades, (grade) => grade.status === "pass").length, exchanges.length)
			Vitest.assert.isTrue(exchanges.length > 0)
		}),
	)
})
