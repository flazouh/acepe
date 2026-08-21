import { expect, test } from "bun:test"

import {
	BUN_RUNTIME_FILENAME,
	bunLauncherWrapperScript,
	GUI_PROCESS_FILENAME,
	needsGuiProcessRename,
} from "./gui-process-name.ts"

test("needsGuiProcessRename when the runtime is still named bun", () => {
	expect(needsGuiProcessRename(["launcher", BUN_RUNTIME_FILENAME, "libNativeWrapper.dylib"])).toBe(
		true,
	)
	expect(needsGuiProcessRename(["launcher", GUI_PROCESS_FILENAME, BUN_RUNTIME_FILENAME])).toBe(
		false,
	)
	expect(needsGuiProcessRename(["launcher", GUI_PROCESS_FILENAME])).toBe(false)
})

test("bunLauncherWrapperScript execs the Acepe-named runtime", () => {
	expect(bunLauncherWrapperScript(GUI_PROCESS_FILENAME)).toBe(`#!/bin/sh
exec "$(dirname "$0")/${GUI_PROCESS_FILENAME}" "$@"
`)
})
