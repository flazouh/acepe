import * as Predicate from "effect/Predicate";
import type { DownloadEvent, Update, UpdateCheckOutcome } from "$lib/utils/updater-types.js";
import { LOGGER_IDS } from "../acp/constants/logger-ids.js";
import { createLogger } from "../acp/utils/logger.js";
import type { ElectrobunRpcBridge } from "./client.js";

/**
 * The webview's view of the shell's updater.
 *
 * The app version and whether an update exists are facts the bun process owns:
 * only it can read `version.json` out of the app bundle and only it can swap
 * that bundle. The webview asks and renders. Everything in this module is a
 * projection of a shell answer, never a second updater.
 *
 * The requests are taken as a parameter so a test can drive them without an
 * Electrobun window.
 */
export type ShellUpdaterRequests = Pick<
	ElectrobunRpcBridge["request"],
	| "getAppVersion"
	| "checkForUpdate"
	| "downloadUpdate"
	| "applyUpdate"
	| "updateDownloadProgress"
	| "relaunchApp"
>;

export type ShellUpdateProgress = {
	readonly downloadedBytes: number;
	readonly totalBytes: number | null;
};

const DOWNLOAD_POLL_INTERVAL_MS = 400;

const logger = createLogger({
	id: LOGGER_IDS.ELECTROBUN_SHIMS,
	name: "Shell Updater",
});

const asRecord = (value: unknown): Record<string, unknown> | null =>
	Predicate.isObject(value) ? (value as Record<string, unknown>) : null;

const readString = (value: unknown): string | null => {
	if (typeof value !== "string") {
		return null;
	}
	return value.length > 0 ? value : null;
};

const readCount = (value: unknown): number | null => {
	if (typeof value !== "number" || Number.isFinite(value) === false || value < 0) {
		return null;
	}
	return value;
};

export function readAppVersionResponse(response: unknown): string | null {
	const record = asRecord(response);
	if (record === null) {
		return null;
	}
	return readString(record.version);
}

export type ShellUpdateCheck =
	| { readonly kind: "available"; readonly version: string }
	| { readonly kind: "none" }
	| { readonly kind: "failed"; readonly message: string };

export function readCheckForUpdateResponse(response: unknown): ShellUpdateCheck {
	const record = asRecord(response);
	if (record === null) {
		return { kind: "failed", message: "the shell answered the update check with nothing" };
	}
	const error = readString(record.error);
	if (error !== null) {
		return { kind: "failed", message: error };
	}
	const version = readString(record.version);
	if (version === null) {
		return { kind: "none" };
	}
	return { kind: "available", version };
}

export function readUpdateWorkResponse(response: unknown): string | null {
	const record = asRecord(response);
	if (record === null) {
		return "the shell answered the update request with nothing";
	}
	const error = readString(record.error);
	if (error !== null) {
		return error;
	}
	return record.ok === true ? null : "the shell refused the update request";
}

export function readUpdateProgressResponse(response: unknown): ShellUpdateProgress | null {
	const record = asRecord(response);
	if (record === null) {
		return null;
	}
	const downloadedBytes = readCount(record.downloadedBytes);
	if (downloadedBytes === null) {
		return null;
	}
	return {
		downloadedBytes,
		totalBytes: readCount(record.totalBytes),
	};
}

/**
 * Where the download report has got to.
 *
 * The shell counts bytes from zero, the banner adds up chunks. This cursor
 * turns one into the other, and re-announces the size when the shell first
 * learns it, so a download that starts with an unknown length still ends at
 * a real percentage.
 */
export type DownloadReportCursor = {
	readonly announcedTotalBytes: number | null;
	readonly reportedBytes: number;
};

export const startDownloadReportCursor = (): DownloadReportCursor => ({
	announcedTotalBytes: null,
	reportedBytes: 0,
});

export function downloadEventsForProgress(
	cursor: DownloadReportCursor,
	progress: ShellUpdateProgress
): {
	readonly cursor: DownloadReportCursor;
	readonly events: ReadonlyArray<DownloadEvent>;
} {
	const events: Array<DownloadEvent> = [];
	let reportedBytes = cursor.reportedBytes;
	let announcedTotalBytes = cursor.announcedTotalBytes;

	if (progress.totalBytes !== null && progress.totalBytes !== announcedTotalBytes) {
		events.push({ event: "Started", data: { contentLength: progress.totalBytes } });
		announcedTotalBytes = progress.totalBytes;
		reportedBytes = 0;
	}

	if (progress.downloadedBytes > reportedBytes) {
		events.push({
			event: "Progress",
			data: { chunkLength: progress.downloadedBytes - reportedBytes },
		});
		reportedBytes = progress.downloadedBytes;
	}

	return { cursor: { announcedTotalBytes, reportedBytes }, events };
}

export function requestAppVersion(requests: ShellUpdaterRequests): Promise<string | null> {
	return requests
		.getAppVersion({})
		.then(readAppVersionResponse)
		.catch(() => null);
}

export function requestRelaunch(requests: ShellUpdaterRequests): Promise<void> {
	return requests.relaunchApp({}).then(() => undefined);
}

type DownloadTimers = {
	readonly setInterval: (handler: () => void, ms: number) => ReturnType<typeof setInterval>;
	readonly clearInterval: (handle: ReturnType<typeof setInterval>) => void;
};

const realTimers: DownloadTimers = {
	setInterval: (handler, ms) => setInterval(handler, ms),
	clearInterval: (handle) => {
		clearInterval(handle);
	},
};

/**
 * Runs the shell download and reports what the shell says about it.
 *
 * The download itself is one long RPC call, so progress cannot ride back on
 * it. The shell keeps the byte count from Electrobun's status stream and this
 * reads it while the download runs.
 */
export function runShellDownload(
	requests: ShellUpdaterRequests,
	onEvent: (event: DownloadEvent) => void,
	timers: DownloadTimers = realTimers
): Promise<void> {
	let cursor = startDownloadReportCursor();
	const poll = (): void => {
		void requests
			.updateDownloadProgress({})
			.then((response) => {
				const progress = readUpdateProgressResponse(response);
				if (progress === null) {
					return;
				}
				const next = downloadEventsForProgress(cursor, progress);
				cursor = next.cursor;
				for (const event of next.events) {
					onEvent(event);
				}
			})
			.catch((cause: unknown) => {
				// The download itself is still running: a lost progress read only
				// costs this tick's percentage. Say so once per tick rather than
				// letting the bar stall with no account of why.
				logger.warn("update download progress read failed", { cause });
			});
	};
	const handle = timers.setInterval(poll, DOWNLOAD_POLL_INTERVAL_MS);
	return requests
		.downloadUpdate({})
		.then((response) => {
			const error = readUpdateWorkResponse(response);
			if (error !== null) {
				throw new Error(error);
			}
			onEvent({ event: "Finished" });
		})
		.finally(() => {
			timers.clearInterval(handle);
		});
}

/**
 * Asks the shell whether an update exists.
 *
 * Answers an outcome rather than throwing, because "the check failed" is one
 * of the three things that can happen and the caller has to render it.
 */
export function requestUpdateCheck(
	requests: ShellUpdaterRequests,
	timers: DownloadTimers = realTimers
): Promise<UpdateCheckOutcome> {
	return requests.checkForUpdate({}).then(
		(response): UpdateCheckOutcome => {
			const check = readCheckForUpdateResponse(response);
			if (check.kind === "failed") {
				return { kind: "failed", message: check.message };
			}
			if (check.kind === "none") {
				return { kind: "none" };
			}
			const update: Update = {
				version: check.version,
				download: (onEvent: (event: DownloadEvent) => void) =>
					runShellDownload(requests, onEvent, timers),
				install: () =>
					requests.applyUpdate({}).then((applied) => {
						const error = readUpdateWorkResponse(applied);
						if (error !== null) {
							throw new Error(error);
						}
					}),
			};
			return { kind: "available", update };
		},
		(cause: unknown): UpdateCheckOutcome => ({
			kind: "failed",
			message: cause instanceof Error ? cause.message : String(cause),
		})
	);
}
