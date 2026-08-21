import { describe, expect, it } from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Schema from "effect/Schema"
import * as TestClock from "effect/testing/TestClock"
import { QaHelperTimeout, QaScreenshotDisabled } from "../errors.ts"
import { createTokenState, makeQaBridgeClient } from "../host/bridge-client.ts"
import { QaWindowInfo } from "../host/protocol.ts"
import { makeQaSession } from "../host/session.ts"
import { createTogglePage } from "../preload/qa-preload.ts"
import { formatCliValue, HELPER_NAMES, makeRuntimeHelpers } from "./helpers.ts"

const sessionWithPage = () =>
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

describe("helpers", () => {
	it.effect("click then snapshotText observe a DOM change", () =>
		Effect.gen(function* () {
			const logs: Array<string> = []
			const helpers = makeRuntimeHelpers(sessionWithPage(), logs)
			yield* helpers.click({ text: "Toggle" })
			const text = yield* helpers.snapshotText()
			expect(text).toBe("Acepe\n  Toggle\n  Opened")
			helpers.cliLog(text)
			expect(logs).toEqual(["Acepe\n  Toggle\n  Opened"])
		}),
	)

	it.effect("every helper name has help text", () =>
		Effect.sync(() => {
			const logs: Array<string> = []
			const helpers = makeRuntimeHelpers(sessionWithPage(), logs)
			for (const name of HELPER_NAMES) {
				expect(helpers.help(name).includes(name)).toBe(true)
			}
			expect(formatCliValue("plain")).toBe("plain")
			expect(formatCliValue(1)).toBe("1")
		}),
	)

	it.effect("captureScreenshot fails with a named error and does not hang", () =>
		Effect.gen(function* () {
			const helpers = makeRuntimeHelpers(sessionWithPage(), [])
			const error = yield* Effect.flip(helpers.captureScreenshot())
			expect(Schema.is(QaScreenshotDisabled)(error)).toBe(true)
		}),
	)

	it.effect("wait fails with QaHelperTimeout when the deadline passes", () =>
		Effect.gen(function* () {
			const helpers = makeRuntimeHelpers(sessionWithPage(), [])
			const fiber = yield* Effect.forkChild(helpers.wait(60_000))
			yield* TestClock.adjust(Duration.millis(5_000))
			const exit = yield* Fiber.await(fiber)
			expect(Exit.isFailure(exit)).toBe(true)
			if (Exit.isSuccess(exit) === true) {
				return
			}
			const error = Cause.squash(exit.cause)
			expect(Schema.is(QaHelperTimeout)(error)).toBe(true)
		}),
	)

	it.effect("waitForText fails with QaHelperTimeout when the text never appears", () =>
		Effect.gen(function* () {
			const helpers = makeRuntimeHelpers(sessionWithPage(), [])
			const fiber = yield* Effect.forkChild(helpers.waitForText("never-shown"))
			yield* TestClock.adjust(Duration.millis(5_000))
			const exit = yield* Fiber.await(fiber)
			expect(Exit.isFailure(exit)).toBe(true)
			if (Exit.isSuccess(exit) === true) {
				return
			}
			const error = Cause.squash(exit.cause)
			expect(Schema.is(QaHelperTimeout)(error)).toBe(true)
		}),
	)
})
