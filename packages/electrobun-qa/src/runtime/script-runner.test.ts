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
})
