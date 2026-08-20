import { expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"

import { handlePing, pingRequestHandler } from "./ping.ts"

test("webview ping round trip returns the echoed message from bun", () => {
	const returned = pingRequestHandler({ message: "acepe" })
	expect(returned).toEqual({ echo: "acepe" })
})

test("handlePing decodes the request through Schema", () => {
	const returned = Effect.runSync(handlePing({ message: "round-trip" }))
	expect(returned.echo).toBe("round-trip")
})

test("handlePing fails when the payload has no message", () => {
	const exit = Effect.runSyncExit(handlePing({}))
	expect(Exit.isFailure(exit)).toBe(true)
})
