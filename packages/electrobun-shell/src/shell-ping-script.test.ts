import { expect, test } from "bun:test"

import { RPC_ROUNDTRIP_MESSAGE } from "./ping.ts"
import {
	ACEPE_SHELL_INLINE_PING_ATTR,
	acepeShellPingScript,
	injectAcepeShellPingScript,
} from "./shell-ping-script.ts"

test("acepeShellPingScript posts a ping request with the desktop round trip message", () => {
	const script = acepeShellPingScript(RPC_ROUNDTRIP_MESSAGE)
	expect(script.includes('method: "ping"')).toBe(true)
	expect(script.includes("desktop round trip")).toBe(true)
	expect(script.includes("__electrobunBunBridge")).toBe(true)
})

test("injectAcepeShellPingScript inserts the ping before head close", () => {
	const html = `<html><head><title>Acepe</title></head><body></body></html>`
	const injected = injectAcepeShellPingScript(html)
	expect(injected.includes(ACEPE_SHELL_INLINE_PING_ATTR)).toBe(true)
	expect(injected.includes("</head>")).toBe(true)
	expect(injected.indexOf(ACEPE_SHELL_INLINE_PING_ATTR)).toBeLessThan(injected.indexOf("</head>"))
	expect(injectAcepeShellPingScript(injected)).toBe(injected)
})
