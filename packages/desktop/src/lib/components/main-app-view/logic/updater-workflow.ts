import type { DownloadEvent, Update } from "@tauri-apps/plugin-updater";
import { ResultAsync } from "neverthrow";

export type PreparedUpdateHandle = Pick<Update, "version" | "download" | "install">;

function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

export function predownloadUpdate(
	update: PreparedUpdateHandle,
	onEvent: (event: DownloadEvent) => void
): ResultAsync<string, Error> {
	return ResultAsync.fromPromise(update.download(onEvent), toError).map(() => update.version);
}

export function installDownloadedUpdate(
	update: PreparedUpdateHandle,
	relaunchApp: () => Promise<void>
): ResultAsync<void, Error> {
	return ResultAsync.fromPromise(update.install(), toError).andThen(() =>
		ResultAsync.fromPromise(relaunchApp(), toError)
	);
}
