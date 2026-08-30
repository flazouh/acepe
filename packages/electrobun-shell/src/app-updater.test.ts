import { expect, test } from "bun:test"

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
		localInfo: async () => ({ version: "2026.3.33", channel: "stable" }),
		checkForUpdate: async () => noUpdate,
		downloadUpdate: async () => undefined,
		applyUpdate: async () => undefined,
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

test("getAppVersion answers the version the updater read", async () => {
	const { port } = makePort({})
	const handlers = makeUpdaterRpcHandlers(port)
	expect(await handlers.getAppVersion({})).toEqual({
		version: "2026.3.33",
		channel: "stable",
	})
})

test("getAppVersion answers null instead of throwing the bun process down", async () => {
	const { port } = makePort({
		localInfo: async () => {
			throw new Error("version.json is missing")
		},
	})
	const handlers = makeUpdaterRpcHandlers(port)
	expect(await handlers.getAppVersion({})).toEqual({ version: null, channel: null })
})

test("checkForUpdate answers the available version", async () => {
	const { port } = makePort({ checkForUpdate: async () => updateAvailable })
	const handlers = makeUpdaterRpcHandlers(port)
	expect(await handlers.checkForUpdate({})).toEqual({ version: "2026.4.4", error: null })
})

test("checkForUpdate answers no update on the dev channel", async () => {
	const { port } = makePort({})
	const handlers = makeUpdaterRpcHandlers(port)
	expect(await handlers.checkForUpdate({})).toEqual({ version: null, error: null })
})

test("checkForUpdate turns a thrown updater failure into an error string", async () => {
	const { port } = makePort({
		checkForUpdate: async () => {
			throw new Error("network is down")
		},
	})
	const handlers = makeUpdaterRpcHandlers(port)
	expect(await handlers.checkForUpdate({})).toEqual({ version: null, error: "network is down" })
})

test("downloadUpdate reports the failure reason instead of throwing", async () => {
	const { port } = makePort({
		downloadUpdate: async () => {
			throw new Error("patch chain broke")
		},
	})
	const handlers = makeUpdaterRpcHandlers(port)
	expect(await handlers.downloadUpdate({})).toEqual({ ok: false, error: "patch chain broke" })
})

test("updateDownloadProgress follows the bytes the updater reports", async () => {
	const { port, emitProgress } = makePort({})
	const handlers = makeUpdaterRpcHandlers(port)
	expect(await handlers.updateDownloadProgress({})).toEqual({
		downloadedBytes: 0,
		totalBytes: null,
	})
	emitProgress({ downloadedBytes: 1_024, totalBytes: 4_096 })
	expect(await handlers.updateDownloadProgress({})).toEqual({
		downloadedBytes: 1_024,
		totalBytes: 4_096,
	})
})

test("downloadUpdate restarts the progress count for the new download", async () => {
	const { port, emitProgress } = makePort({})
	const handlers = makeUpdaterRpcHandlers(port)
	emitProgress({ downloadedBytes: 4_096, totalBytes: 4_096 })
	await handlers.downloadUpdate({})
	expect(await handlers.updateDownloadProgress({})).toEqual({
		downloadedBytes: 0,
		totalBytes: null,
	})
})

test("relaunchApp asks the shell for the relaunch primitive", async () => {
	const { port, relaunches } = makePort({})
	const handlers = makeUpdaterRpcHandlers(port)
	expect(await handlers.relaunchApp({})).toEqual({ ok: true, error: null })
	expect(relaunches.length).toBe(1)
})

test("relaunchApp reports a failed relaunch instead of throwing", async () => {
	const { port } = makePort({
		relaunch: () => {
			throw new Error("no app bundle")
		},
	})
	const handlers = makeUpdaterRpcHandlers(port)
	expect(await handlers.relaunchApp({})).toEqual({ ok: false, error: "no app bundle" })
})

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
