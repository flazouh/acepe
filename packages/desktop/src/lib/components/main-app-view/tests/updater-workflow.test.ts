import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import type { DownloadEvent, Update, UpdateCheckOutcome } from "$lib/utils/updater-types.js";
import {
	downloadAndInstallUpdate,
	installDownloadedUpdate,
	type PreparedUpdateHandle,
	predownloadUpdate,
	updaterStateForCheckOutcome,
} from "../logic/updater-workflow.js";

describe("updater-workflow", () => {
	it("downloads an available update without installing it", async () => {
		const order: string[] = [];
		const events: DownloadEvent[] = [];
		const update: PreparedUpdateHandle = {
			version: "1.2.3",
			download: async (onEvent) => {
				order.push("download");
				onEvent?.({ event: "Started", data: { contentLength: 100 } });
				onEvent?.({ event: "Finished" });
			},
			install: async () => {
				order.push("install");
			},
		};

		const version = await Effect.runPromise(
			predownloadUpdate(update, (event) => {
				events.push(event);
			})
		);

		expect(version).toBe("1.2.3");
		expect(order).toEqual(["download"]);
		expect(events.map((event) => event.event)).toEqual(["Started", "Finished"]);
	});

	it("installs a prepared update and only then relaunches", async () => {
		const order: string[] = [];
		const update: PreparedUpdateHandle = {
			version: "1.2.3",
			download: async () => {
				order.push("download");
			},
			install: async () => {
				order.push("install");
			},
		};

		await Effect.runPromise(
			installDownloadedUpdate(update, async () => {
				order.push("relaunch");
			})
		);

		expect(order).toEqual(["install", "relaunch"]);
	});

	it("downloads installs and relaunches for startup updates", async () => {
		const order: string[] = [];
		const events: DownloadEvent[] = [];
		const update: PreparedUpdateHandle = {
			version: "1.2.3",
			download: async (onEvent) => {
				order.push("download");
				onEvent?.({ event: "Started", data: { contentLength: 100 } });
				onEvent?.({ event: "Finished" });
			},
			install: async () => {
				order.push("install");
			},
		};

		const version = await Effect.runPromise(
			downloadAndInstallUpdate(
				update,
				(event) => {
					events.push(event);
				},
				async () => {
					order.push("relaunch");
				}
			)
		);

		expect(version).toBe("1.2.3");
		expect(order).toEqual(["download", "install", "relaunch"]);
		expect(events.map((event) => event.event)).toEqual(["Started", "Finished"]);
	});
});

describe("the update check outcome", () => {
	const anUpdate: Update = {
		version: "2026.4.4",
		download: async () => undefined,
		install: async () => undefined,
	};

	const outcomes: ReadonlyArray<UpdateCheckOutcome> = [
		{ kind: "available", update: anUpdate },
		{ kind: "none" },
		{ kind: "failed", message: "Failed to fetch update info" },
	];

	it("goes back to idle when an update is available", () => {
		expect(updaterStateForCheckOutcome({ kind: "available", update: anUpdate }).kind).toBe("idle");
	});

	it("goes back to idle when there is no update", () => {
		expect(updaterStateForCheckOutcome({ kind: "none" }).kind).toBe("idle");
	});

	it("shows a failed check as an error, never as no update", () => {
		expect(
			updaterStateForCheckOutcome({
				kind: "failed",
				message: "Failed to fetch update info",
			})
		).toEqual({ kind: "error", message: "Failed to fetch update info" });
	});

	it("leaves the checking state whatever the check answered", () => {
		for (const outcome of outcomes) {
			expect(updaterStateForCheckOutcome(outcome).kind).not.toBe("checking");
		}
	});
});
