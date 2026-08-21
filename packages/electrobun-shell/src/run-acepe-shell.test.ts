import { expect, test } from "bun:test"
import * as Data from "effect/Data"

import {
	type AcepeRpcWork,
	type AcepeShellHost,
	type AcepeShellRpcHandlers,
} from "./start-acepe-shell.ts"
import { SHELL_STARTUP_FAILED_PREFIX } from "./shell-startup-error.ts"
import { launchAcepeShellWindow, makeDeferredRpcWork } from "./run-acepe-shell.ts"

class ShellExitCalled extends Data.TaggedError("ShellExitCalled")<{
	readonly code: number
}> {
	override get message(): string {
		return `shell-exit-${String(this.code)}`
	}
}

const idleWork: AcepeRpcWork = {
	dispatch: (params) => params,
	snapshot: (params) => params,
	events: (params) => params,
	getProjectIndex: (params) => params,
	invalidateProjectIndex: (params) => params,
}

const recordingHost = (): AcepeShellHost<AcepeShellRpcHandlers> => ({
	defineRpc: (handlers) => handlers,
	openWindow: (input) => input,
})

test("ping round trip works before live rpc work is attached", () => {
	const launched = launchAcepeShellWindow(recordingHost(), {
		writeError: () => undefined,
		exit: (code) => {
			throw new ShellExitCalled({ code })
		},
	})
	expect(launched.opened.rpc.ping({ message: "desktop round trip" })).toEqual({
		echo: "desktop round trip",
	})
	expect(launched.opened.activate).toBe(true)
	expect(launched.opened.hidden).toBe(false)
	expect(launched.opened.url).toBe("views://mainview/")
})

test("dispatch before attach fails with a named startup error", () => {
	const deferred = makeDeferredRpcWork()
	expect(() => deferred.work.dispatch({ type: "project.create" })).toThrow(
		`${SHELL_STARTUP_FAILED_PREFIX}: rpc work is not attached`,
	)
	deferred.attach(idleWork)
	expect(deferred.work.dispatch({ type: "project.create" })).toEqual({
		type: "project.create",
	})
})

test("defineRpc throw is written to stderr and exits 1", () => {
	const lines: Array<string> = []
	let code = 0
	expect(() =>
		launchAcepeShellWindow(
			{
				defineRpc: () => {
					throw new Error("rpc handlers rejected")
				},
				openWindow: (input) => input,
			},
			{
				writeError: (line) => {
					lines.push(line)
				},
				exit: (exitCode): never => {
					code = exitCode
					throw new ShellExitCalled({ code: exitCode })
				},
			},
		),
	).toThrow("shell-exit-1")
	expect(code).toBe(1)
	expect(lines.length).toBe(1)
	const line = lines[0]
	expect(line).toContain(SHELL_STARTUP_FAILED_PREFIX)
	expect(line).toContain("rpc handlers rejected")
})

test("openWindow throw is written to stderr and exits 1", () => {
	const lines: Array<string> = []
	expect(() =>
		launchAcepeShellWindow(
			{
				defineRpc: (handlers) => handlers,
				openWindow: () => {
					throw new Error("window create failed")
				},
			},
			{
				writeError: (line) => {
					lines.push(line)
				},
				exit: (exitCode): never => {
					throw new ShellExitCalled({ code: exitCode })
				},
			},
		),
	).toThrow("shell-exit-1")
	expect(lines[0]).toContain(SHELL_STARTUP_FAILED_PREFIX)
	expect(lines[0]).toContain("window create failed")
})

test("attach after launch enables dispatch", () => {
	const launched = launchAcepeShellWindow(recordingHost(), {
		writeError: () => undefined,
		exit: (code) => {
			throw new ShellExitCalled({ code })
		},
	})
	launched.attach({
		dispatch: () => ({ sequence: 1 }),
		snapshot: () => ({ snapshotSequence: 0 }),
		events: () => undefined,
		getProjectIndex: () => ({ totalFiles: 0 }),
		invalidateProjectIndex: () => undefined,
	})
	expect(launched.opened.rpc.dispatch({ type: "project.create" })).toEqual({
		sequence: 1,
	})
})
