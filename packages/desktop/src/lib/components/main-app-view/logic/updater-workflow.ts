import { fromPromise } from "@acepe/effect-result/fromPromise";
import * as Effect from "effect/Effect";
import type { DownloadEvent, Update } from "$lib/utils/updater-types.js";

export type PreparedUpdateHandle = Pick<Update, "version" | "download" | "install">;

function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

export function predownloadUpdate(
	update: PreparedUpdateHandle,
	onEvent: (event: DownloadEvent) => void
): Effect.Effect<string, Error> {
	return fromPromise(() => update.download(onEvent), toError).pipe(
		Effect.map(() => update.version)
	);
}

export function downloadAndInstallUpdate(
	update: PreparedUpdateHandle,
	onEvent: (event: DownloadEvent) => void,
	relaunchApp: () => Promise<void>
): Effect.Effect<string, Error> {
	return fromPromise(() => update.download(onEvent), toError).pipe(
		Effect.map(() => update.version),
		Effect.flatMap((version) =>
			fromPromise(() => update.install(), toError).pipe(
				Effect.flatMap(() => fromPromise(() => relaunchApp(), toError)),
				Effect.map(() => version)
			)
		)
	);
}

export function installDownloadedUpdate(
	update: PreparedUpdateHandle,
	relaunchApp: () => Promise<void>
): Effect.Effect<void, Error> {
	return fromPromise(() => update.install(), toError).pipe(
		Effect.flatMap(() => fromPromise(() => relaunchApp(), toError))
	);
}
