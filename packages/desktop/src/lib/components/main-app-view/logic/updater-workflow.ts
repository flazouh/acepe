import { fromPromise } from "@acepe/effect-result/fromPromise";
import * as Effect from "effect/Effect";
import type { DownloadEvent, Update } from "$lib/utils/updater-types.js";
import {
	createErrorUpdaterState,
	createIdleUpdaterState,
	type UpdaterBannerState,
} from "./updater-state.js";

export type PreparedUpdateHandle = Pick<Update, "version" | "download" | "install">;

function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

/**
 * What one update check settled on.
 *
 * A check that failed is its own outcome. Reading it as "no update" would hide
 * a broken updater behind a quiet app, and leaving it unhandled would strand
 * the banner on "Checking update..." for the rest of the session.
 */
export type UpdateCheckOutcome =
	| { readonly kind: "available"; readonly update: Update }
	| { readonly kind: "none" }
	| { readonly kind: "failed"; readonly message: string };

export function runUpdateCheck(
	check: () => Promise<Update | null>
): Promise<UpdateCheckOutcome> {
	return check().then(
		(update): UpdateCheckOutcome =>
			update === null ? { kind: "none" } : { kind: "available", update },
		(cause): UpdateCheckOutcome => ({ kind: "failed", message: toError(cause).message })
	);
}

/** Every outcome leaves "checking", so the banner can never get stuck there. */
export function updaterStateForCheckOutcome(outcome: UpdateCheckOutcome): UpdaterBannerState {
	if (outcome.kind === "failed") {
		return createErrorUpdaterState(outcome.message);
	}
	return createIdleUpdaterState();
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
