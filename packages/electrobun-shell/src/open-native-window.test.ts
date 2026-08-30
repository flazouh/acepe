import { expect, test } from "bun:test"
import * as Data from "effect/Data"

import { pingRequestHandler } from "./ping.ts"
import {
	electrobunWindowOptions,
	realizeAcepeNativeWindow,
	startElectrobunAcepeApp,
} from "./open-native-window.ts"
import { SHELL_STARTUP_FAILED_PREFIX } from "./shell-startup-error.ts"
import type { ShellUpdaterPort } from "./app-updater.ts"
import { acepeWindowSpec } from "./window-spec.ts"

// The updater talks to the network and to the app bundle on disk. These
// window tests only need the shell to build, so the port answers nothing.
const silentUpdaterPort: ShellUpdaterPort = {
	localInfo: async () => ({ version: "", channel: "" }),
	checkForUpdate: async () => ({ version: "", updateAvailable: false, error: "" }),
	downloadUpdate: async () => undefined,
	applyUpdate: async () => undefined,
	relaunch: () => undefined,
	onDownloadProgress: () => undefined,
}

class ShellExitCalled extends Data.TaggedError("ShellExitCalled")<{
	readonly code: number
}> {
	override get message(): string {
		return `shell-exit-${String(this.code)}`
	}
}

test("electrobun window options forward activate hidden title url frame and rpc", () => {
	const options = electrobunWindowOptions({
		title: acepeWindowSpec.title,
		url: acepeWindowSpec.url,
		frame: acepeWindowSpec.frame,
		titleBarStyle: acepeWindowSpec.titleBarStyle,
		activate: acepeWindowSpec.activate,
		hidden: acepeWindowSpec.hidden,
		preload: acepeWindowSpec.preload,
		rpc: { ping: pingRequestHandler },
	})
	expect(options.activate).toBe(true)
	expect(options.hidden).toBe(false)
	expect(options.title).toBe("Acepe")
	expect(options.url).toBe("views://mainview/index.html")
	expect(options.frame.width).toBe(1512)
	expect(options.rpc.ping({ message: "desktop round trip" })).toEqual({
		echo: "desktop round trip",
	})
})

test("realizeAcepeNativeWindow shows and activates a window with a native pointer", () => {
	const calls: Array<string> = []
	realizeAcepeNativeWindow(
		{
			ptr: 1,
			id: 1,
			show: () => {
				calls.push("show")
			},
			activate: () => {
				calls.push("activate")
			},
		},
		{ hidden: false },
	)
	expect(calls).toEqual(["show", "activate"])
})

test("realizeAcepeNativeWindow does not show a hidden window", () => {
	const calls: Array<string> = []
	realizeAcepeNativeWindow(
		{
			ptr: 1,
			id: 1,
			show: () => {
				calls.push("show")
			},
			activate: () => {
				calls.push("activate")
			},
		},
		{ hidden: true },
	)
	expect(calls).toEqual([])
})

test("realizeAcepeNativeWindow throws when BrowserWindow returns no native pointer", () => {
	expect(() =>
		realizeAcepeNativeWindow(
			{
				ptr: null,
				id: 1,
				show: () => undefined,
				activate: () => undefined,
			},
			{ hidden: false },
		),
	).toThrow(`${SHELL_STARTUP_FAILED_PREFIX}: BrowserWindow returned without a native pointer`)
})

test("startElectrobunAcepeApp opens an activated window and proves the ping echo", () => {
	const lines: Array<string> = []
	const created: Array<{ readonly activate: boolean; readonly hidden: boolean }> = []
	const jsCalls: Array<string> = []
	const launched = startElectrobunAcepeApp(
		{
			defineRPC: (input) => input.handlers.requests,
			BrowserWindow: class {
				ptr = 1
				id = 1
				webview = {
					rpc: {
						send: {
							events: () => undefined,
						},
					},
					executeJavascript: (js: string) => {
						jsCalls.push(js)
					},
				}
				constructor(options: { readonly activate: boolean; readonly hidden: boolean }) {
					created.push({
						activate: options.activate,
						hidden: options.hidden,
					})
				}
				setPageZoom(): void {
					return undefined
				}
				show(): void {
					return undefined
				}
				activate(): void {
					return undefined
				}
			},
			setDockIconVisible: () => undefined,
			updater: silentUpdaterPort,
		},
		{
			writeError: (line) => {
				lines.push(line)
			},
			exit: (code) => {
				throw new ShellExitCalled({ code })
			},
		},
	)
	expect(created).toEqual([{ activate: true, hidden: false }])
	expect(launched.opened.activate).toBe(true)
	expect(launched.opened.hidden).toBe(false)
	launched.executeJavascript("ping()")
	expect(jsCalls).toEqual(["ping()"])
	expect(launched.opened.rpc.ping({ message: "desktop round trip" })).toEqual({
		echo: "desktop round trip",
	})
	expect(lines).toEqual([
		"acepe-shell-window-opened: Acepe",
		"acepe-shell-rpc-roundtrip: desktop round trip",
	])
	expect(launched.opened.preload).toBeNull()
})

test("startElectrobunAcepeApp opens the native window without a title bar", () => {
	const created: Array<string> = []
	const launched = startElectrobunAcepeApp(
		{
			defineRPC: (input) => input.handlers.requests,
			BrowserWindow: class {
				ptr = 1
				id = 1
				webview = {
					rpc: {
						send: {
							events: () => undefined,
						},
					},
					executeJavascript: () => undefined,
				}
				constructor(options: { readonly titleBarStyle: string }) {
					created.push(options.titleBarStyle)
				}
				setPageZoom(): void {
					return undefined
				}
				show(): void {
					return undefined
				}
				activate(): void {
					return undefined
				}
			},
			setDockIconVisible: () => undefined,
			updater: silentUpdaterPort,
		},
		{
			writeError: () => undefined,
			exit: (code) => {
				throw new ShellExitCalled({ code })
			},
		},
	)

	expect(created).toEqual(["hiddenInset"])
	expect(launched.opened.titleBarStyle).toBe("hiddenInset")
})

test("startElectrobunAcepeApp serves setPageZoom from the native window", () => {
	const zoomCalls: Array<number> = []
	const launched = startElectrobunAcepeApp(
		{
			defineRPC: (input) => input.handlers.requests,
			BrowserWindow: class {
				ptr = 1
				id = 1
				webview = {
					rpc: {
						send: {
							events: () => undefined,
						},
					},
					executeJavascript: () => undefined,
				}
				setPageZoom(level: number): void {
					zoomCalls.push(level)
				}
				show(): void {
					return undefined
				}
				activate(): void {
					return undefined
				}
			},
			setDockIconVisible: () => undefined,
			updater: silentUpdaterPort,
		},
		{
			writeError: () => undefined,
			exit: (code) => {
				throw new ShellExitCalled({ code })
			},
		},
	)

	expect(launched.opened.rpc.setPageZoom({ level: 1.3 })).toEqual({ level: 1.3 })
	expect(zoomCalls).toEqual([1.3])
})

test("startElectrobunAcepeApp ignores a setPageZoom request without a usable level", () => {
	const zoomCalls: Array<number> = []
	const launched = startElectrobunAcepeApp(
		{
			defineRPC: (input) => input.handlers.requests,
			BrowserWindow: class {
				ptr = 1
				id = 1
				webview = {
					rpc: {
						send: {
							events: () => undefined,
						},
					},
					executeJavascript: () => undefined,
				}
				setPageZoom(level: number): void {
					zoomCalls.push(level)
				}
				show(): void {
					return undefined
				}
				activate(): void {
					return undefined
				}
			},
			setDockIconVisible: () => undefined,
			updater: silentUpdaterPort,
		},
		{
			writeError: () => undefined,
			exit: (code) => {
				throw new ShellExitCalled({ code })
			},
		},
	)

	expect(launched.opened.rpc.setPageZoom({ level: "huge" })).toEqual({ level: null })
	expect(zoomCalls).toEqual([])
})

test("startElectrobunAcepeApp forwards a QA preload into the native window", () => {
	const created: Array<string | null> = []
	const launched = startElectrobunAcepeApp(
		{
			defineRPC: (input) => input.handlers.requests,
			BrowserWindow: class {
				ptr = 1
				id = 1
				webview = {
					rpc: {
						send: {
							events: () => undefined,
						},
					},
					executeJavascript: () => undefined,
				}
				constructor(options: { readonly preload: string | null }) {
					created.push(options.preload)
				}
				setPageZoom(): void {
					return undefined
				}
				show(): void {
					return undefined
				}
				activate(): void {
					return undefined
				}
			},
			setDockIconVisible: () => undefined,
			updater: silentUpdaterPort,
		},
		{
			writeError: () => undefined,
			exit: (code) => {
				throw new ShellExitCalled({ code })
			},
		},
		{ preload: "window.__electrobunQa = {};", devUrl: null },
	)
	expect(created).toEqual(["window.__electrobunQa = {};"])
	expect(launched.opened.preload).toBe("window.__electrobunQa = {};")
})

const urlRecordingBindings = (created: Array<string>) => ({
	defineRPC: (input: { readonly handlers: { readonly requests: unknown } }) =>
		input.handlers.requests,
	BrowserWindow: class {
		ptr = 1
		id = 1
		webview = {
			rpc: {
				send: {
					events: () => undefined,
				},
			},
			executeJavascript: () => undefined,
		}
		constructor(options: { readonly url: string }) {
			created.push(options.url)
		}
		setPageZoom(): void {
			return undefined
		}
		show(): void {
			return undefined
		}
		activate(): void {
			return undefined
		}
	},
	setDockIconVisible: () => undefined,
	updater: silentUpdaterPort,
})

const silentIo = {
	writeError: () => undefined,
	exit: (code: number) => {
		throw new ShellExitCalled({ code })
	},
}

test("startElectrobunAcepeApp loads a dev url instead of the copied bundle", () => {
	const created: Array<string> = []
	const launched = startElectrobunAcepeApp(urlRecordingBindings(created), silentIo, {
		preload: null,
		devUrl: "http://localhost:1420",
	})
	expect(created).toEqual(["http://localhost:1420"])
	expect(launched.opened.url).toBe("http://localhost:1420")
})

test("startElectrobunAcepeApp keeps the copied bundle without a dev url", () => {
	const created: Array<string> = []
	const launched = startElectrobunAcepeApp(urlRecordingBindings(created), silentIo, {
		preload: null,
		devUrl: null,
	})
	expect(created).toEqual(["views://mainview/index.html"])
	expect(launched.opened.url).toBe("views://mainview/index.html")
})
