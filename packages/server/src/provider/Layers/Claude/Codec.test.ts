import {
	gradeExchanges,
	loadFixture,
	makeReport,
	referenceFixturePath,
	type CompletedExchange
} from "@acepe/harness"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import type { Json, JsonObject } from "../Json.ts"
import {
	acpSessionUpdateToFact,
	contractFactToAcpSessionUpdate,
	roundTripAcpSessionUpdate
} from "./Codec.ts"

const Platform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer)

const AcpSessionUpdateNotification = Schema.Struct({
	jsonrpc: Schema.String,
	method: Schema.String,
	params: Schema.Struct({
		sessionId: Schema.String,
		seq: Schema.Number,
		payload: Schema.Json
	})
})
const decodeNotification = Schema.decodeUnknownExit(AcpSessionUpdateNotification)

const jsonObject = (value: JsonObject): JsonObject => value

const remapNotification = (notification: Json): Json => {
	const decoded = decodeNotification(notification)
	if (Exit.isFailure(decoded) || decoded.value.method !== "acp-session-update") {
		return notification
	}
	const remapped = roundTripAcpSessionUpdate(decoded.value.params.payload)
	Vitest.assert.isTrue(Option.isSome(remapped))
	if (Option.isNone(remapped)) {
		return notification
	}
	return {
		jsonrpc: decoded.value.jsonrpc,
		method: decoded.value.method,
		params: {
			sessionId: decoded.value.params.sessionId,
			seq: decoded.value.params.seq,
			payload: remapped.value
		}
	}
}

Vitest.describe("ACP session-update codec", () => {
	Vitest.it("round-trips the reference compaction payload", () => {
		const payload = jsonObject({
			type: "compactionEvent",
			event: {
				eventId: "596f3dc8-3c16-4768-afe0-c87d75fd8cfa",
				sessionId: "81fde13c-1b27-4552-8b90-25b04c88aa50",
				status: "completed",
				trigger: "auto",
				preCompactionTokens: 999455,
				postCompactionTokens: 25288,
				durationMs: 117657,
				preservedMessageCount: 16,
				cumulativeDroppedTokens: 2917434,
				timestampMs: 1786956901034,
				providerMetadata: {
					source: "compact_boundary",
					uuid: "596f3dc8-3c16-4768-afe0-c87d75fd8cfa"
				}
			}
		})
		const fact = acpSessionUpdateToFact(payload)
		Vitest.assert.isTrue(Option.isSome(fact))
		if (Option.isSome(fact)) {
			Vitest.assert.deepStrictEqual(contractFactToAcpSessionUpdate(fact.value), payload)
		}
	})
})

Vitest.layer(Platform)("claude-session-reference fixture", (it) => {
	it.effect("grades reconstructed ACP session updates at 100 percent", () =>
		Effect.gen(function*() {
			const filePath = yield* referenceFixturePath()
			const exchanges = yield* loadFixture(filePath)
			const actuals = yield* Effect.forEach(exchanges, (exchange) =>
				Effect.gen(function*() {
					const notifications = Arr.map(exchange.notifications, remapNotification)
					const completed: CompletedExchange = {
						command: exchange.command,
						payload: exchange.payload,
						response: exchange.response,
						notifications
					}
					return Option.some(completed)
				})
			)
			const grades = gradeExchanges(exchanges, actuals, Arr.empty())
			const report = makeReport("claude-session-reference.ndjson", grades)
			Vitest.assert.strictEqual(report.fail, 0)
			Vitest.assert.strictEqual(report.pass, exchanges.length)
			Vitest.assert.strictEqual(report.skipped, 0)
		})
	)
})
