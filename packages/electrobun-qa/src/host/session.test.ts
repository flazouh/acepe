import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { createTogglePage } from "../preload/qa-preload.ts"
import { createTokenState, makeQaBridgeClient } from "./bridge-client.ts"
import { QaSocketRequest, QaWindowInfo } from "./protocol.ts"
import { makeQaSession } from "./session.ts"

const silentClient = makeQaBridgeClient({
	sender: {
		executeJavascript: () => undefined,
	},
	tokens: createTokenState(),
})

describe("session", () => {
	it.effect("doctor reports title url and window count", () =>
		Effect.gen(function* () {
			const session = makeQaSession({
				windows: [
					QaWindowInfo.make({
						id: "1",
						title: "Acepe",
						url: "views://mainview/index.html",
					}),
				],
				client: silentClient,
			})
			const report = yield* session.doctor()
			expect(report).toBe(
				"doctor: ok\n- title: Acepe\n- url: views://mainview/index.html\n- windows: 1",
			)
		}),
	)

	it.effect("fails doctor when no window exists", () =>
		Effect.gen(function* () {
			const session = makeQaSession({
				windows: [],
				client: silentClient,
			})
			const error = yield* Effect.flip(session.doctor())
			expect(error._tag).toBe("QaWindowNotFound")
		}),
	)

	it.effect("click then snapshotText observe a DOM change on a memory page", () =>
		Effect.gen(function* () {
			const page = createTogglePage()
			const session = makeQaSession({
				windows: [
					QaWindowInfo.make({
						id: "1",
						title: "Acepe",
						url: "views://mainview/index.html",
					}),
				],
				client: silentClient,
				memoryPage: page,
			})
			yield* session.call("qa:click", { text: "Toggle" })
			const text = yield* session.call("qa:snapshotText", {})
			expect(text).toBe("Acepe\n  Toggle\n  Opened")
		}),
	)

	it.effect("maps helper names on the socket protocol", () =>
		Effect.gen(function* () {
			const page = createTogglePage()
			const session = makeQaSession({
				windows: [
					QaWindowInfo.make({
						id: "1",
						title: "Acepe",
						url: "views://mainview/index.html",
					}),
				],
				client: silentClient,
				memoryPage: page,
			})
			const request = yield* Schema.decodeUnknownEffect(QaSocketRequest)({
				id: "1",
				method: "snapshotText",
			})
			const text = yield* session.handleSocketRequest(request)
			expect(text).toBe("Acepe\n  Toggle\n  Closed")
		}),
	)
})
