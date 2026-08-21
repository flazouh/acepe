import { describe, expect, it } from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Schema from "effect/Schema"
import * as TestClock from "effect/testing/TestClock"
import { QaEvalTimeout } from "../errors.ts"
import { QA_RESULT_MESSAGE_ID } from "../preload/qa-preload.ts"
import {
	bindQaResultHandler,
	createTokenState,
	DEFAULT_HELPER_DEADLINE,
	makeQaBridgeClient,
} from "./bridge-client.ts"

describe("bridge-client", () => {
	it.effect("returns the webview payload for a matching token", () =>
		Effect.gen(function* () {
			const sent: Array<string> = []
			const client = makeQaBridgeClient({
				sender: {
					executeJavascript: (js) => {
						sent.push(js)
					},
				},
				tokens: createTokenState(),
			})
			const fiber = yield* Effect.forkChild(
				client.request({
					method: "qa:snapshotText",
					params: {},
				}),
			)
			yield* Effect.yieldNow
			yield* client.receiveResult({
				id: "qa-1",
				success: true,
				payload: "Acepe\n  Toggle",
			})
			const value = yield* Fiber.join(fiber)
			expect(sent.length).toBe(1)
			expect(sent[0]?.includes("qa:snapshotText")).toBe(true)
			expect(value).toBe("Acepe\n  Toggle")
		}),
	)

	it.effect("fails with QaEvalTimeout when the webview does not answer", () =>
		Effect.gen(function* () {
			const client = makeQaBridgeClient({
				sender: {
					executeJavascript: () => undefined,
				},
				tokens: createTokenState(),
			})
			const fiber = yield* Effect.forkChild(
				client.request(
					{
						method: "qa:snapshotText",
						params: {},
					},
					Duration.millis(50),
				),
			)
			yield* TestClock.adjust(Duration.millis(50))
			const exit = yield* Fiber.await(fiber)
			expect(Exit.isFailure(exit)).toBe(true)
			if (Exit.isSuccess(exit) === true) {
				return
			}
			const error = Cause.squash(exit.cause)
			expect(Schema.is(QaEvalTimeout)(error)).toBe(true)
			if (Schema.is(QaEvalTimeout)(error) === true) {
				expect(error.message).toBe("QaEvalTimeout: webview did not answer token qa-1")
			}
		}),
	)

	it.effect("binds qa:result on an Electrobun internal message map", () =>
		Effect.sync(() => {
			const message: Record<string, (payload: unknown) => void> = {}
			const handlers = { message }
			const received: Array<unknown> = []
			bindQaResultHandler(handlers, (payload) => {
				received.push(payload)
			})
			const handler = handlers.message[QA_RESULT_MESSAGE_ID]
			expect(typeof handler).toBe("function")
			if (handler !== undefined) {
				handler({ id: "qa-1", success: true, payload: "ok" })
			}
			expect(received).toEqual([{ id: "qa-1", success: true, payload: "ok" }])
		}),
	)

	it.effect("uses a 5s default deadline", () =>
		Effect.sync(() => {
			expect(Duration.toMillis(DEFAULT_HELPER_DEADLINE)).toBe(5_000)
		}),
	)
})
