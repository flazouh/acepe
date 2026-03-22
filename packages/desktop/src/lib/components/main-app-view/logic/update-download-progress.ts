import type { DownloadEvent } from "@tauri-apps/plugin-updater";

export interface UpdateDownloadProgressState {
	downloadedBytes: number;
	totalBytes: number | undefined;
}

export function applyDownloadEventToProgress(
	state: UpdateDownloadProgressState,
	event: DownloadEvent
): UpdateDownloadProgressState {
	if (event.event === "Started") {
		return {
			downloadedBytes: 0,
			totalBytes: event.data.contentLength ?? undefined,
		};
	}

	if (event.event === "Progress") {
		const nextDownloaded = state.downloadedBytes + event.data.chunkLength;
		if (state.totalBytes == null) {
			return { ...state, downloadedBytes: nextDownloaded };
		}

		return {
			...state,
			downloadedBytes: Math.min(nextDownloaded, state.totalBytes),
		};
	}

	return {
		...state,
		downloadedBytes: state.totalBytes ?? state.downloadedBytes,
	};
}
