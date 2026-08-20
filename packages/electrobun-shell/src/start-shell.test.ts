import { expect, test } from "bun:test"

import { pingRequestHandler } from "./ping.ts"
import { startShell } from "./start-shell.ts"
import { acepeWindowSpec } from "./window-spec.ts"

test("startShell opens one window on the svelte bundle", () => {
	const opened = startShell({
		defineRpc: (handlers) => handlers,
		openWindow: (input) => input,
	})
	expect(opened.url).toBe(acepeWindowSpec.url)
	expect(opened.title).toBe("Acepe")
})

test("webview to bun round trip asserts on the returned value", () => {
	const opened = startShell({
		defineRpc: (handlers) => handlers,
		openWindow: (input) => input,
	})
	const returned = opened.rpc.ping({ message: "hello from webview" })
	expect(returned).toEqual({ echo: "hello from webview" })
	expect(returned).toEqual(pingRequestHandler({ message: "hello from webview" }))
})
