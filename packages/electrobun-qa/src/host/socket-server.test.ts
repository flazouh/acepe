import { describe, expect, it } from "@effect/vitest"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { createTogglePage } from "../preload/qa-preload.ts"
import { createTokenState, makeQaBridgeClient } from "./bridge-client.ts"
import { QaSocketRequest, QaSocketRequestLine, QaWindowInfo } from "./protocol.ts"
import { makeQaSession } from "./session.ts"
import { handleSocketLine, sendSocketRequest, startQaHost } from "./socket-server.ts"

const memorySession = () =>
	makeQaSession({
		windows: [
			QaWindowInfo.make({
				id: "1",
				title: "Acepe",
				url: "views://mainview/index.html",
			}),
		],
		client: makeQaBridgeClient({
			sender: {
				executeJavascript: () => undefined,
			},
			tokens: createTokenState(),
		}),
		memoryPage: createTogglePage(),
	})

describe("socket-server", () => {
	it.effect("refuses to start the host on a signed build", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				startQaHost({
					signed: true,
					path: "/tmp/electrobun-qa/signed.sock",
					session: memorySession(),
				}),
			)
			expect(error._tag).toBe("QaSignedBuild")
			expect(error.message).toBe("QaSignedBuild: QA host is absent from a signed build")
		}),
	)

	it.effect("handles a doctor line without hanging", () =>
		Effect.gen(function* () {
			const line = yield* Schema.encodeUnknownEffect(QaSocketRequestLine)(
				QaSocketRequest.make({
					id: "1",
					method: "doctor",
				}),
			)
			const response = yield* handleSocketLine(memorySession(), line)
			expect(response.includes("doctor: ok")).toBe(true)
			expect(response.includes("Acepe")).toBe(true)
			expect(response.includes("views://mainview/index.html")).toBe(true)
		}),
	)

	it.effect("answers doctor over a unix socket", () =>
		Effect.gen(function* () {
			const path = "/tmp/electrobun-qa/ac056-test.sock"
			const host = yield* startQaHost({
				signed: false,
				path,
				session: memorySession(),
			})
			const response = yield* sendSocketRequest(
				path,
				QaSocketRequest.make({ id: "1", method: "doctor" }),
				Duration.seconds(2),
			)
			expect(response.ok).toBe(true)
			if (response.ok === true) {
				expect(String(response.value).includes("doctor: ok")).toBe(true)
			}
			expect(host.path).toBe(path)
		}),
	)

	it.effect("fails with QaAppNotRunning when no host listens", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				sendSocketRequest(
					"/tmp/electrobun-qa/missing-ac056.sock",
					QaSocketRequest.make({ id: "1", method: "doctor" }),
					Duration.millis(50),
				),
			)
			expect(error._tag).toBe("QaAppNotRunning")
		}),
	)
})
