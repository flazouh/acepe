import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { createTokenState, makeQaBridgeClient } from "../host/bridge-client.ts"
import { QaWindowInfo } from "../host/protocol.ts"
import { makeQaSession } from "../host/session.ts"
import { createTogglePage } from "../preload/qa-preload.ts"
import { runUserScript } from "./script-runner.ts"

const toggleSession = () =>
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

describe("script-runner", () => {
	it.effect("logs snapshotText from a heredoc script", () =>
		Effect.gen(function* () {
			const logs = yield* runUserScript("cliLog(await snapshotText())", toggleSession())
			expect(logs).toEqual(["Acepe\n  Toggle\n  Closed"])
		}),
	)

	it.effect("click then snapshotText in the same script observe a DOM change", () =>
		Effect.gen(function* () {
			const logs = yield* runUserScript(
				`await click({ text: "Toggle" })
cliLog(await snapshotText())`,
				toggleSession(),
			)
			expect(logs).toEqual(["Acepe\n  Toggle\n  Opened"])
		}),
	)

	it.effect("accepts the issue-241 heredoc helper shapes", () =>
		Effect.gen(function* () {
			const logs = yield* runUserScript(
				`await fillInput({ selector: "#toggle", value: "hello from qa" })
await pressKey({ key: "Enter" })
await waitForText("hello from qa", { timeoutMs: 10000 })
cliLog(await snapshotText({ selector: "#toggle" }))`,
				toggleSession(),
			)
			expect(logs).toEqual(["hello from qa"])
		}),
	)

	it.effect("snapshotDom scopes to a selector instead of returning the whole page", () =>
		Effect.gen(function* () {
			const logs = yield* runUserScript(
				`cliLog(await snapshotDom({ selector: "#toggle" }))`,
				toggleSession(),
			)
			expect(logs).toEqual(['<button id="toggle">Toggle</button>'])
		}),
	)

	it.effect(
		"snapshotText accepts a plain-string selector instead of silently returning the whole page",
		() =>
			Effect.gen(function* () {
				const logs = yield* runUserScript(
					`cliLog(await snapshotText("#toggle"))`,
					toggleSession(),
				)
				expect(logs).toEqual(["Toggle"])
			}),
	)

	it.effect(
		"snapshotDom accepts a plain-string selector instead of silently returning the whole page",
		() =>
			Effect.gen(function* () {
				const logs = yield* runUserScript(
					`cliLog(await snapshotDom("#toggle"))`,
					toggleSession(),
				)
				expect(logs).toEqual(['<button id="toggle">Toggle</button>'])
			}),
	)

	it.effect("snapshotDom fails loudly with QaElementNotFound when scoped to nothing", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				runUserScript(`await snapshotDom({ selector: "#missing" })`, toggleSession()),
			)
			expect(error._tag).toBe("QaElementNotFound")
		}),
	)

	it.effect("snapshotText fails loudly with QaElementNotFound when scoped to nothing", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				runUserScript(`await snapshotText({ selector: "#missing" })`, toggleSession()),
			)
			expect(error._tag).toBe("QaElementNotFound")
		}),
	)
})
