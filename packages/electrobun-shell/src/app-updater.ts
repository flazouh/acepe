/**
 * The shell side of the app updater.
 *
 * Electrobun's `Updater` lives in the bun process: it reads
 * `Resources/version.json`, fetches the channel's update manifest, downloads
 * the tarball or the patch chain, and swaps the app bundle. The webview owns
 * none of that. It asks over RPC and renders what the shell answers.
 *
 * Every handler here answers a value instead of throwing. An electrobun RPC
 * handler that throws takes the bun process with it, so a failed update check
 * comes back as an `error` string and the window stays up.
 */

import * as Effect from "effect/Effect"

export type ShellUpdaterLocalInfo = {
	readonly version: string
	readonly channel: string
}

export type ShellUpdaterCheck = {
	readonly version: string
	readonly updateAvailable: boolean
	readonly error: string
}

export type ShellUpdateDownloadProgress = {
	readonly downloadedBytes: number
	readonly totalBytes: number | null
}

/**
 * What the shell needs from Electrobun's `Updater` plus a relaunch primitive.
 *
 * The port exists so the update check can be driven in a test. Electrobun's
 * Updater talks to the network and to the app bundle on disk, neither of
 * which a unit test has.
 */
export type ShellUpdaterPort = {
	readonly localInfo: () => Promise<ShellUpdaterLocalInfo>
	readonly checkForUpdate: () => Promise<ShellUpdaterCheck>
	readonly downloadUpdate: () => Promise<void>
	readonly applyUpdate: () => Promise<void>
	readonly relaunch: () => void
	/** Called once, at handler construction, to follow the download. */
	readonly onDownloadProgress: (
		listener: (progress: ShellUpdateDownloadProgress) => void
	) => void
}

export type AppVersionResponse = {
	readonly version: string | null
	readonly channel: string | null
}

/**
 * `version` is set only when an update is actually available, and `error` only
 * when the check failed. Both null means the app is already up to date, which
 * is the answer the dev channel always gives.
 */
export type CheckForUpdateResponse = {
	readonly version: string | null
	readonly error: string | null
}

export type UpdateWorkResponse = {
	readonly ok: boolean
	readonly error: string | null
}

export type UpdateDownloadProgressResponse = ShellUpdateDownloadProgress

export type AcepeUpdaterRpcHandlers = {
	readonly getAppVersion: (params: unknown) => Promise<AppVersionResponse>
	readonly checkForUpdate: (params: unknown) => Promise<CheckForUpdateResponse>
	readonly downloadUpdate: (params: unknown) => Promise<UpdateWorkResponse>
	readonly applyUpdate: (params: unknown) => Promise<UpdateWorkResponse>
	readonly updateDownloadProgress: (params: unknown) => Promise<UpdateDownloadProgressResponse>
	readonly relaunchApp: (params: unknown) => Promise<UpdateWorkResponse>
}

const NO_PROGRESS: ShellUpdateDownloadProgress = {
	downloadedBytes: 0,
	totalBytes: null,
}

const failureReason = (cause: unknown): string => {
	if (cause instanceof Error) {
		return cause.message
	}
	if (typeof cause === "string" && cause.length > 0) {
		return cause
	}
	return "updater call failed"
}

/**
 * Empty strings mean electrobun could not read version.json. The webview must
 * see that as "no version", not as a version chip reading "v".
 */
const presentString = (value: string): string | null => (value.length > 0 ? value : null)

export const appVersionResponse = (info: ShellUpdaterLocalInfo): AppVersionResponse => ({
	version: presentString(info.version),
	channel: presentString(info.channel),
})

export const checkForUpdateResponse = (check: ShellUpdaterCheck): CheckForUpdateResponse => {
	if (check.error.length > 0) {
		return { version: null, error: check.error }
	}
	if (check.updateAvailable === false) {
		return { version: null, error: null }
	}
	const version = presentString(check.version)
	if (version === null) {
		return { version: null, error: "update available without a version" }
	}
	return { version, error: null }
}

const attempt = <A>(run: () => Promise<A>): Effect.Effect<A, string> =>
	Effect.tryPromise({ try: run, catch: failureReason })

const workResponse = (work: Effect.Effect<unknown, string>): Effect.Effect<UpdateWorkResponse> =>
	work.pipe(
		Effect.as({ ok: true, error: null }),
		Effect.catch((error) => Effect.succeed({ ok: false, error }))
	)

export const makeUpdaterRpcHandlers = (port: ShellUpdaterPort): AcepeUpdaterRpcHandlers => {
	let progress: ShellUpdateDownloadProgress = NO_PROGRESS
	port.onDownloadProgress((next) => {
		progress = next
	})
	const getAppVersion = attempt(() => port.localInfo()).pipe(
		Effect.map(appVersionResponse),
		Effect.orElseSucceed(() => ({ version: null, channel: null }))
	)
	const checkForUpdate = attempt(() => port.checkForUpdate()).pipe(
		Effect.map(checkForUpdateResponse),
		Effect.catch((error) => Effect.succeed({ version: null, error }))
	)
	const downloadUpdate = workResponse(
		Effect.gen(function* () {
			progress = NO_PROGRESS
			yield* attempt(() => port.downloadUpdate())
		})
	)
	const applyUpdate = workResponse(attempt(() => port.applyUpdate()))
	const relaunchApp = workResponse(Effect.try({ try: () => port.relaunch(), catch: failureReason }))
	return {
		getAppVersion: () => Effect.runPromise(getAppVersion),
		checkForUpdate: () => Effect.runPromise(checkForUpdate),
		downloadUpdate: () => Effect.runPromise(downloadUpdate),
		applyUpdate: () => Effect.runPromise(applyUpdate),
		updateDownloadProgress: () => Promise.resolve(progress),
		relaunchApp: () => Effect.runPromise(relaunchApp),
	}
}

/**
 * Electrobun reports download progress as status entries on one global
 * callback. Only the byte counts matter to the webview, so everything else is
 * dropped here rather than in the webview.
 */
export type ElectrobunUpdateStatusEntry = {
	readonly status: string
	readonly details?: {
		readonly bytesDownloaded?: number
		readonly totalBytes?: number
	}
}

export const downloadProgressFromStatus = (
	entry: ElectrobunUpdateStatusEntry
): ShellUpdateDownloadProgress | null => {
	if (entry.status !== "download-progress") {
		return null
	}
	const downloaded = entry.details?.bytesDownloaded
	if (typeof downloaded !== "number" || Number.isFinite(downloaded) === false) {
		return null
	}
	const total = entry.details?.totalBytes
	const usableTotal =
		typeof total === "number" && Number.isFinite(total) === true && total > 0 ? total : null
	return { downloadedBytes: downloaded, totalBytes: usableTotal }
}

/**
 * The relaunch command for macOS and Linux.
 *
 * `open` on an app bundle that is still running only activates the existing
 * instance, so the detached shell waits for this process to disappear before
 * it opens the bundle again. This mirrors what Electrobun's own applyUpdate
 * does after it swaps the bundle.
 */
export const relaunchCommand = (input: {
	readonly pid: number
	readonly appBundlePath: string
}): ReadonlyArray<string> => [
	"sh",
	"-c",
	`while kill -0 ${String(input.pid)} 2>/dev/null; do sleep 0.5; done; sleep 1; open "${input.appBundlePath}"`,
]

/**
 * Walks up from the launcher executable to the `.app` bundle that contains it.
 *
 * Returns null outside a bundle, which is where `bun run` puts the shell
 * during development. Relaunch is not available there.
 */
export const appBundlePathFromExecutable = (execPath: string): string | null => {
	const segments = execPath.split("/")
	for (let index = segments.length - 1; index >= 0; index -= 1) {
		const segment = segments[index]
		if (segment !== undefined && segment.endsWith(".app") === true) {
			return segments.slice(0, index + 1).join("/")
		}
	}
	return null
}
