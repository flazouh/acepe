import { expect, test } from "bun:test"
import * as Effect from "effect/Effect"

import {
	appBundlePathFromExecutable,
	appVersionResponse,
	checkForUpdateResponse,
	downloadProgressFromStatus,
	makeUpdaterRpcHandlers,
	relaunchCommand,
	type ShellUpdateDownloadProgress,
	type ShellUpdaterCheck,
	type ShellUpdaterPort,
} from "./app-updater.ts"

const noUpdate: ShellUpdaterCheck = {
	version: "2026.3.33",
	updateAvailable: false,
	error: "",
}

const updateAvailable: ShellUpdaterCheck = {
	version: "2026.4.4",
	updateAvailable: true,
	error: "",
}

type PortOverrides = Partial<ShellUpdaterPort>

const makePort = (
	overrides: PortOverrides
): {
	readonly port: ShellUpdaterPort
	readonly emitProgress: (progress: ShellUpdateDownloadProgress) => void
	readonly relaunches: Array<number>
} => {
	const relaunches: Array<number> = []
	let listener: (progress: ShellUpdateDownloadProgress) => void = () => undefined
	const port: ShellUpdaterPort = {
		localInfo: () => Promise.resolve({ version: "2026.3.33", channel: "stable" }),
		checkForUpdate: () => Promise.resolve(noUpdate),
		downloadUpdate: () => Promise.resolve(undefined),
		applyUpdate: () => Promise.resolve(undefined),
		relaunch: () => {
			relaunches.push(1)
		},
		onDownloadProgress: (next) => {
			listener = next
		},
		...overrides,
	}
	return {
		port,
		emitProgress: (progress) => {
			listener(progress)
		},
		relaunches,
	}
}

test("appVersionResponse carries the version and channel the shell read", () => {
	expect(appVersionResponse({ version: "2026.3.33", channel: "stable" })).toEqual({
		version: "2026.3.33",
		channel: "stable",
	})
})

test("appVersionResponse reports a missing version.json as no version", () => {
	expect(appVersionResponse({ version: "", channel: "" })).toEqual({
		version: null,
		channel: null,
	})
})

test("checkForUpdateResponse reports the new version when an update is available", () => {
	expect(checkForUpdateResponse(updateAvailable)).toEqual({
		version: "2026.4.4",
		error: null,
	})
})

test("checkForUpdateResponse reports no update and no error when up to date", () => {
	expect(checkForUpdateResponse(noUpdate)).toEqual({ version: null, error: null })
})

test("checkForUpdateResponse keeps the failure reason from the updater", () => {
	expect(
		checkForUpdateResponse({
			version: "",
			updateAvailable: false,
			error: "Failed to fetch update info",
		})
	).toEqual({ version: null, error: "Failed to fetch update info" })
})

test("checkForUpdateResponse refuses an available update without a version", () => {
	const response = checkForUpdateResponse({ version: "", updateAvailable: true, error: "" })
	expect(response.version).toBeNull()
	expect(response.error).toBe("update available without a version")
})

test("getAppVersion answers the version the updater read", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const { port } = makePort({})
			const handlers = makeUpdaterRpcHandlers(port)
			const response = yield* Effect.promise(() => handlers.getAppVersion({}))
			expect(response).toEqual({ version: "2026.3.33", channel: "stable" })
		})
	))

test("getAppVersion answers null instead of throwing the bun process down", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const { port } = makePort({
				localInfo: () => Promise.reject(new Error("version.json is missing")),
			})
			const handlers = makeUpdaterRpcHandlers(port)
			const response = yield* Effect.promise(() => handlers.getAppVersion({}))
			expect(response).toEqual({ version: null, channel: null })
		})
	))

test("checkForUpdate answers the available version", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const { port } = makePort({ checkForUpdate: () => Promise.resolve(updateAvailable) })
			const handlers = makeUpdaterRpcHandlers(port)
			const response = yield* Effect.promise(() => handlers.checkForUpdate({}))
			expect(response).toEqual({ version: "2026.4.4", error: null })
		})
	))

test("checkForUpdate answers no update on the dev channel", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const { port } = makePort({})
			const handlers = makeUpdaterRpcHandlers(port)
			const response = yield* Effect.promise(() => handlers.checkForUpdate({}))
			expect(response).toEqual({ version: null, error: null })
		})
	))

test("checkForUpdate turns a thrown updater failure into an error string", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const { port } = makePort({
				checkForUpdate: () => Promise.reject(new Error("network is down")),
			})
			const handlers = makeUpdaterRpcHandlers(port)
			const response = yield* Effect.promise(() => handlers.checkForUpdate({}))
			expect(response).toEqual({ version: null, error: "network is down" })
		})
	))

test("downloadUpdate reports the failure reason instead of throwing", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const { port } = makePort({
				downloadUpdate: () => Promise.reject(new Error("patch chain broke")),
			})
			const handlers = makeUpdaterRpcHandlers(port)
			const response = yield* Effect.promise(() => handlers.downloadUpdate({}))
			expect(response).toEqual({ ok: false, error: "patch chain broke" })
		})
	))

test("updateDownloadProgress follows the bytes the updater reports", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const { port, emitProgress } = makePort({})
			const handlers = makeUpdaterRpcHandlers(port)
			const before = yield* Effect.promise(() => handlers.updateDownloadProgress({}))
			expect(before).toEqual({ downloadedBytes: 0, totalBytes: null })
			emitProgress({ downloadedBytes: 1_024, totalBytes: 4_096 })
			const after = yield* Effect.promise(() => handlers.updateDownloadProgress({}))
			expect(after).toEqual({ downloadedBytes: 1_024, totalBytes: 4_096 })
		})
	))

test("downloadUpdate restarts the progress count for the new download", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const { port, emitProgress } = makePort({})
			const handlers = makeUpdaterRpcHandlers(port)
			emitProgress({ downloadedBytes: 4_096, totalBytes: 4_096 })
			yield* Effect.promise(() => handlers.downloadUpdate({}))
			const progress = yield* Effect.promise(() => handlers.updateDownloadProgress({}))
			expect(progress).toEqual({ downloadedBytes: 0, totalBytes: null })
		})
	))

test("relaunchApp asks the shell for the relaunch primitive", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const { port, relaunches } = makePort({})
			const handlers = makeUpdaterRpcHandlers(port)
			const response = yield* Effect.promise(() => handlers.relaunchApp({}))
			expect(response).toEqual({ ok: true, error: null })
			expect(relaunches.length).toBe(1)
		})
	))

test("relaunchApp reports a failed relaunch instead of throwing", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const { port } = makePort({
				relaunch: () => {
					throw new Error("no app bundle")
				},
			})
			const handlers = makeUpdaterRpcHandlers(port)
			const response = yield* Effect.promise(() => handlers.relaunchApp({}))
			expect(response).toEqual({ ok: false, error: "no app bundle" })
		})
	))

test("downloadProgressFromStatus reads the byte counts off a progress entry", () => {
	expect(
		downloadProgressFromStatus({
			status: "download-progress",
			details: { bytesDownloaded: 512, totalBytes: 2_048 },
		})
	).toEqual({ downloadedBytes: 512, totalBytes: 2_048 })
})

test("downloadProgressFromStatus ignores every other status", () => {
	expect(downloadProgressFromStatus({ status: "checking" })).toBeNull()
})

test("downloadProgressFromStatus drops an unusable total", () => {
	expect(
		downloadProgressFromStatus({
			status: "download-progress",
			details: { bytesDownloaded: 512, totalBytes: 0 },
		})
	).toEqual({ downloadedBytes: 512, totalBytes: null })
})

test("relaunchCommand waits for this process to exit before it opens the bundle", () => {
	const command = relaunchCommand({ pid: 4242, appBundlePath: "/Applications/Acepe.app" })
	expect(command[0]).toBe("sh")
	expect(command[2]).toContain("kill -0 4242")
	expect(command[2]).toContain('open "/Applications/Acepe.app"')
})

test("appBundlePathFromExecutable walks up to the app bundle", () => {
	expect(appBundlePathFromExecutable("/Applications/Acepe.app/Contents/MacOS/launcher")).toBe(
		"/Applications/Acepe.app"
	)
})

test("appBundlePathFromExecutable answers null outside a bundle", () => {
	expect(appBundlePathFromExecutable("/usr/local/bin/bun")).toBeNull()
})
