import { describe, expect, it } from "@effect/vitest"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { createTogglePage } from "../preload/qa-preload.ts"
import { createTokenState, makeQaBridgeClient } from "./bridge-client.ts"
import { QaSocketRequest, QaSocketRequestLine, QaWindowInfo } from "./protocol.ts"
import { makeQaSession } from "./session.ts"
import { handleSocketLine, sendSocketRequest, startQaHost } from "./socket-server.ts"

// A host that opens the connection but never answers: this is the "large
// snapshotDom, xterm mounted" shape that previously misreported as
// QaAppNotRunning. It never writes a response line, so a caller's deadline
// is what ends the request, not the host.
const startSlowHost = (path: string): { readonly linesReceived: () => number; readonly stop: () => void } => {
	let received = 0
	const server = Bun.listen({
		unix: path,
		socket: {
			data: (_socket, data) => {
				const text = typeof data === "string" ? data : new TextDecoder().decode(data)
				if (text.includes("\n") === true) {
					received += 1
				}
				// Deliberately never respond.
			},
			error: () => undefined,
			close: () => undefined,
		},
	})
	return {
		linesReceived: () => received,
		stop: () => {
			server.stop(true)
			Bun.spawnSync(["rm", "-f", path])
		},
	}
}

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

	// it.live, not it.effect: this test depends on a real unix-socket connection
	// actually opening and a real deadline elapsing while nothing answers, so it
	// needs the live Clock, not the virtual TestClock other timeout tests step
	// by hand.
	it.live(
		"fails with QaResponseTimeout, not QaAppNotRunning, when the app is connected but slow",
		() =>
			Effect.gen(function* () {
				const path = "/tmp/electrobun-qa/slow-ac-qa-snapshot-errors.sock"
				Bun.spawnSync(["mkdir", "-p", "/tmp/electrobun-qa"])
				Bun.spawnSync(["rm", "-f", path])
				const slow = startSlowHost(path)
				const error = yield* Effect.flip(
					sendSocketRequest(
						path,
						QaSocketRequest.make({ id: "1", method: "snapshotDom" }),
						Duration.millis(100),
					),
				)
				expect(error._tag).toBe("QaResponseTimeout")
				if (error._tag === "QaResponseTimeout") {
					expect(error.path).toBe(path)
					expect(error.method).toBe("snapshotDom")
				}
				// A response timeout must not be retried: the connect-level retry
				// in writeAndReadUnix only fires for a broken-after-open connection,
				// and sendSocketRequest adds no retry of its own around the
				// deadline. Exactly one request line should have reached the host.
				expect(slow.linesReceived()).toBe(1)
				slow.stop()
			}),
	)
})
