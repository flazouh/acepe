import { SidecarNotification } from "@acepe/sidecar"
import * as Vitest from "@effect/vitest"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { ingestAppLine, ingestSidecarLine, makeCorrelator, requestIdKey } from "./correlate.ts"
import { encodeJsonLine } from "./fixture.ts"

const requestLine = Effect.fn("requestLine")((id: number, method: string, payload: Schema.Json) =>
	encodeJsonLine({
		jsonrpc: "2.0",
		id,
		method,
		params: payload,
	}),
)

const successLine = Effect.fn("successLine")((id: number, result: Schema.Json) =>
	encodeJsonLine({
		jsonrpc: "2.0",
		id,
		result,
	}),
)

const notificationLine = Effect.fn("notificationLine")((method: string, payload: Schema.Json, seq: number) =>
	encodeJsonLine({
		jsonrpc: "2.0",
		method,
		params: {
			sessionId: "66affa11-28c2-4bc6-bd47-ceb539aacda7",
			seq,
			payload,
		},
	}),
)

Vitest.describe("requestIdKey", () => {
	Vitest.it("keeps string ids distinct from numeric ids", () => {
		Vitest.assert.strictEqual(requestIdKey(1), "n:1")
		Vitest.assert.strictEqual(requestIdKey("1"), "s:1")
	})
})

Vitest.describe("correlate", () => {
	Vitest.it.effect("binds ordered notifications to the request they followed", () =>
		Effect.gen(function* () {
			const state = yield* makeCorrelator()
			const prompt = yield* requestLine(3, "acp_send_prompt", {
				session_id: "66affa11-28c2-4bc6-bd47-ceb539aacda7",
				request: { text: "How many PRs do we have in the stack?" },
			})
			yield* ingestAppLine(state, prompt)
			yield* ingestSidecarLine(
				state,
				yield* notificationLine("acp-session-update", { type: "tool_call", toolCallId: "toolu_01" }, 1),
			)
			yield* ingestSidecarLine(
				state,
				yield* notificationLine("acp-session-update", { type: "permissionRequest" }, 2),
			)
			const completed = yield* ingestSidecarLine(state, yield* successLine(3, null))
			Vitest.assert.isTrue(Option.isSome(completed))
			if (Option.isSome(completed)) {
				Vitest.assert.strictEqual(completed.value.command, "acp_send_prompt")
				Vitest.assert.deepStrictEqual(completed.value.payload, {
					session_id: "66affa11-28c2-4bc6-bd47-ceb539aacda7",
					request: { text: "How many PRs do we have in the stack?" },
				})
				Vitest.assert.deepStrictEqual(completed.value.response, {
					jsonrpc: "2.0",
					id: 3,
					result: null,
				})
				const notifications = yield* Effect.forEach(completed.value.notifications, (notification) =>
					Schema.decodeUnknownEffect(SidecarNotification)(notification),
				)
				Vitest.assert.deepStrictEqual(
					Arr.map(notifications, (notification) => notification.params.seq),
					[1, 2],
				)
			}
		}),
	)

	Vitest.it.effect("keeps notifications on the oldest in-flight request", () =>
		Effect.gen(function* () {
			const state = yield* makeCorrelator()
			yield* ingestAppLine(state, yield* requestLine(1, "acp_send_prompt", { n: 1 }))
			yield* ingestAppLine(state, yield* requestLine(2, "acp_respond_inbound_request", { n: 2 }))
			yield* ingestSidecarLine(
				state,
				yield* notificationLine("acp-session-update", { type: "agentMessageChunk" }, 7),
			)
			const firstDone = yield* ingestSidecarLine(state, yield* successLine(1, { ok: true }))
			const secondDone = yield* ingestSidecarLine(state, yield* successLine(2, { ok: true }))
			Vitest.assert.isTrue(Option.isSome(firstDone))
			Vitest.assert.isTrue(Option.isSome(secondDone))
			if (Option.isSome(firstDone) && Option.isSome(secondDone)) {
				Vitest.assert.strictEqual(firstDone.value.notifications.length, 1)
				Vitest.assert.strictEqual(secondDone.value.notifications.length, 0)
			}
		}),
	)
})
