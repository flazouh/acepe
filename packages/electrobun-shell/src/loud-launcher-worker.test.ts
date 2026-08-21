import { expect, test } from "bun:test"

import {
	launcherWorkerIsLoud,
	LOUD_LAUNCHER_WORKER,
	makeLauncherWorkerLoud,
	QUIET_LAUNCHER_WORKER,
} from "./loud-launcher-worker.ts"
import { SHELL_STARTUP_FAILED_PREFIX } from "./shell-startup-error.ts"

const quietMain = `  process.on("SIGINT", () => {});
  ${QUIET_LAUNCHER_WORKER}
  lib.symbols.startEventLoop(ptr(buf));
`

test("makeLauncherWorkerLoud inherits worker stdout and stderr", () => {
	const loud = makeLauncherWorkerLoud(quietMain)
	expect(launcherWorkerIsLoud(loud)).toBe(true)
	expect(loud.includes(LOUD_LAUNCHER_WORKER)).toBe(true)
	expect(loud.includes(QUIET_LAUNCHER_WORKER)).toBe(false)
	expect(loud.includes("startEventLoop")).toBe(true)
})

test("makeLauncherWorkerLoud is stable when the launcher is already loud", () => {
	const loud = makeLauncherWorkerLoud(quietMain)
	expect(makeLauncherWorkerLoud(loud)).toBe(loud)
})

test("makeLauncherWorkerLoud fails loud when the Worker call is missing", () => {
	expect(() => makeLauncherWorkerLoud("lib.symbols.startEventLoop();")).toThrow(
		`${SHELL_STARTUP_FAILED_PREFIX}: launcher main.js has no Worker(appEntrypointPath, {}) call`,
	)
})
