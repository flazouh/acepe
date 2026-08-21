import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import {
	QaAppNotRunning,
	QaElementNotFound,
	QaEvalFailed,
	QaEvalTimeout,
	QaHelperTimeout,
	QaScreenshotDisabled,
	QaSignedBuild,
	QaSocketError,
	QaUnknownCommand,
	QaWindowNotFound,
} from "./errors.ts"

describe("errors", () => {
	it.effect("names a missing app with the socket path", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				new QaAppNotRunning({ path: "/tmp/electrobun-qa/com.acepe.app.sock" }),
			)
			expect(error._tag).toBe("QaAppNotRunning")
			expect(error.message).toBe(
				"QaAppNotRunning: no Electrobun app is listening at /tmp/electrobun-qa/com.acepe.app.sock",
			)
		}),
	)

	it.effect("names a webview timeout with the token", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(new QaEvalTimeout({ token: "qa-1" }))
			expect(error.message).toBe("QaEvalTimeout: webview did not answer token qa-1")
		}),
	)

	it.effect("names a helper deadline", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(new QaHelperTimeout({ helper: "waitForText" }))
			expect(error.message).toBe("QaHelperTimeout: waitForText passed its deadline")
		}),
	)

	it.effect("names a missing element query", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(new QaElementNotFound({ query: "text=Toggle" }))
			expect(error.message).toBe("QaElementNotFound: no element matched text=Toggle")
		}),
	)

	it.effect("names a missing window", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(new QaWindowNotFound({ windowId: "2" }))
			expect(error.message).toBe("QaWindowNotFound: 2")
		}),
	)

	it.effect("names a signed-build block", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				new QaSignedBuild({ reason: "QA host is absent from a signed build" }),
			)
			expect(error.message).toBe("QaSignedBuild: QA host is absent from a signed build")
		}),
	)

	it.effect("names an unknown CLI command", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(new QaUnknownCommand({ command: "inspect" }))
			expect(error.message).toBe("QaUnknownCommand: inspect")
		}),
	)

	it.effect("names a socket failure", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(new QaSocketError({ reason: "EADDRINUSE" }))
			expect(error.message).toBe("QaSocketError: EADDRINUSE")
		}),
	)

	it.effect("names an eval failure", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(new QaEvalFailed({ reason: "x is not defined" }))
			expect(error.message).toBe("QaEvalFailed: x is not defined")
		}),
	)

	it.effect("rejects screenshots as QA evidence", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(new QaScreenshotDisabled())
			expect(error.message).toBe(
				"QaScreenshotDisabled: use snapshotText; screenshots are not QA evidence",
			)
		}),
	)
})
