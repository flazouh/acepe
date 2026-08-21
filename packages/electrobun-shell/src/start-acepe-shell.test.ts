import { expect, test } from "bun:test"

import { pingRequestHandler } from "./ping.ts"
import { startAcepeShell } from "./start-acepe-shell.ts"
import { acepeWindowSpec } from "./window-spec.ts"

test("startAcepeShell opens the svelte bundle and exposes dispatch snapshot events", () => {
	const opened = startAcepeShell(
		{
			defineRpc: (handlers) => handlers,
			openWindow: (input) => input
		},
		{
			dispatch: (params) => ({ dispatched: params }),
			snapshot: (params) => ({ snapshotted: params }),
			events: (params) => ({ streamed: params })
		}
	)
	expect(opened.url).toBe(acepeWindowSpec.url)
	expect(opened.title).toBe("Acepe")
	expect(opened.rpc.ping({ message: "hello from webview" })).toEqual({
		echo: "hello from webview"
	})
	expect(opened.rpc.ping({ message: "hello from webview" })).toEqual(
		pingRequestHandler({ message: "hello from webview" })
	)
	expect(opened.rpc.dispatch({ type: "project.create" })).toEqual({
		dispatched: { type: "project.create" }
	})
	expect(opened.rpc.snapshot({ sessionId: "session-1" })).toEqual({
		snapshotted: { sessionId: "session-1" }
	})
	expect(opened.rpc.events({ fromSequence: 0 })).toEqual({
		streamed: { fromSequence: 0 }
	})
})
