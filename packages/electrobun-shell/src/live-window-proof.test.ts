import { expect, test } from "bun:test"

import {
	judgeLiveWindowProof,
	parseRpcRoundtripEcho,
	parseSystemEventsProcessNames,
	visibleProcessListContainsAcepe,
} from "./live-window-proof.ts"
import { formatRpcRoundtripLine, RPC_ROUNDTRIP_MESSAGE } from "./ping.ts"

test("rpc round trip line parses the echoed value from the window", () => {
	const line = formatRpcRoundtripLine(RPC_ROUNDTRIP_MESSAGE)
	expect(parseRpcRoundtripEcho(line)).toBe("desktop round trip")
	expect(parseRpcRoundtripEcho("[LAUNCHER] Loading app code from flat files")).toBeNull()
})

test("System Events process list detects Acepe as a non-background app", () => {
	const names = parseSystemEventsProcessNames("Cursor, Acepe, Terminal")
	expect(names).toEqual(["Cursor", "Acepe", "Terminal"])
	expect(visibleProcessListContainsAcepe(names)).toBe(true)
	expect(visibleProcessListContainsAcepe(["launcher"])).toBe(true)
	expect(visibleProcessListContainsAcepe(["Finder", "Terminal"])).toBe(false)
})

test("live window proof passes only with the ping echo and a visible Acepe process", () => {
	const passed = judgeLiveWindowProof({
		logText: `[LAUNCHER] Loading app code from flat files\n${formatRpcRoundtripLine(RPC_ROUNDTRIP_MESSAGE)}\n`,
		processListStdout: "Cursor, Acepe, Terminal",
	})
	expect(passed).toEqual({
		echo: "desktop round trip",
		acepeVisible: true,
		passed: true,
	})
	const failed = judgeLiveWindowProof({
		logText: "[LAUNCHER] Loading app code from flat files\n",
		processListStdout: "Finder, Terminal",
	})
	expect(failed.passed).toBe(false)
	expect(failed.echo).toBeNull()
	expect(failed.acepeVisible).toBe(false)
})
