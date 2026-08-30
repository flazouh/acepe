import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import type { DownloadEvent } from "$lib/utils/updater-types.js";

import type { Update } from "$lib/utils/updater-types.js";
import {
	downloadAndInstallUpdate,
	installDownloadedUpdate,
	type PreparedUpdateHandle,
	predownloadUpdate,
	runUpdateCheck,
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

	it("reports the update the shell found", async () => {
		const outcome = await runUpdateCheck(() => Promise.resolve(anUpdate));
		expect(outcome).toEqual({ kind: "available", update: anUpdate });
		expect(updaterStateForCheckOutcome(outcome).kind).toBe("idle");
	});

	it("reports no update and goes back to idle", async () => {
		const outcome = await runUpdateCheck(() => Promise.resolve(null));
		expect(outcome).toEqual({ kind: "none" });
		expect(updaterStateForCheckOutcome(outcome).kind).toBe("idle");
	});

	it("reports a failed check as an error, never as no update", async () => {
		const outcome = await runUpdateCheck(() =>
			Promise.reject(new Error("Failed to fetch update info"))
		);
		expect(outcome).toEqual({ kind: "failed", message: "Failed to fetch update info" });
		expect(updaterStateForCheckOutcome(outcome)).toEqual({
			kind: "error",
			message: "Failed to fetch update info",
		});
	});

	it("leaves the checking state whatever the check answered", async () => {
		const outcomes = await Promise.all([
			runUpdateCheck(() => Promise.resolve(anUpdate)),
			runUpdateCheck(() => Promise.resolve(null)),
			runUpdateCheck(() => Promise.reject(new Error("network is down"))),
		]);
		for (const outcome of outcomes) {
			expect(updaterStateForCheckOutcome(outcome).kind).not.toBe("checking");
		}
	});
});
