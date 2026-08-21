import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { createTokenState, makeQaBridgeClient } from "./host/bridge-client.ts"
import { QaWindowInfo } from "./host/protocol.ts"
import { makeQaSession } from "./host/session.ts"
import { createTogglePage } from "./preload/qa-preload.ts"
import { executeCli } from "./cli.ts"

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

describe("cli", () => {
	it.effect("doctor reports title url and count", () =>
		Effect.gen(function* () {
			const result = yield* executeCli({
				argv: ["doctor"],
				stdin: Effect.succeed(""),
				session: toggleSession(),
			})
			expect(result.code).toBe(0)
			expect(result.lines).toEqual([
				"doctor: ok\n- title: Acepe\n- url: views://mainview/index.html\n- windows: 1",
			])
		}),
	)

	it.effect("doctor exits non-zero when no window is available", () =>
		Effect.gen(function* () {
			const result = yield* executeCli({
				argv: ["doctor"],
				stdin: Effect.succeed(""),
				session: makeQaSession({
					windows: [],
					client: makeQaBridgeClient({
						sender: {
							executeJavascript: () => undefined,
						},
						tokens: createTokenState(),
					}),
				}),
			})
			expect(result.code).toBe(1)
			expect(result.lines[0]?.startsWith("QaWindowNotFound:")).toBe(true)
		}),
	)

	it.effect("run logs snapshotText from a heredoc", () =>
		Effect.gen(function* () {
			const result = yield* executeCli({
				argv: ["run"],
				stdin: Effect.succeed("cliLog(await snapshotText())"),
				session: toggleSession(),
			})
			expect(result.code).toBe(0)
			expect(result.lines).toEqual(["Acepe\n  Toggle\n  Closed"])
		}),
	)

	it.effect("run click then snapshotText in the same script", () =>
		Effect.gen(function* () {
			const result = yield* executeCli({
				argv: ["run"],
				stdin: Effect.succeed(
					`await click({ text: "Toggle" })
cliLog(await snapshotText())`,
				),
				session: toggleSession(),
			})
			expect(result.code).toBe(0)
			expect(result.lines).toEqual(["Acepe\n  Toggle\n  Opened"])
		}),
	)

	it.effect("unknown commands fail with QaUnknownCommand", () =>
		Effect.gen(function* () {
			const result = yield* executeCli({
				argv: ["inspect"],
				stdin: Effect.succeed(""),
			})
			expect(result.code).toBe(1)
			expect(result.lines).toEqual(["QaUnknownCommand: inspect"])
		}),
	)

	it.effect("help lists the helper surface", () =>
		Effect.gen(function* () {
			const result = yield* executeCli({
				argv: ["help"],
				stdin: Effect.succeed(""),
			})
			expect(result.code).toBe(0)
			expect(result.lines[0]).toBe("electrobun-qa run | doctor | help")
			expect(result.lines.some((line) => line.includes("snapshotText"))).toBe(true)
			expect(result.lines.some((line) => line.includes("cliLog"))).toBe(true)
		}),
	)
})
