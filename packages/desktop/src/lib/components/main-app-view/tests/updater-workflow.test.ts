import { describe, expect, it } from "bun:test";
import type { DownloadEvent } from "@tauri-apps/plugin-updater";
import * as Effect from "effect/Effect";

import {
	downloadAndInstallUpdate,
	installDownloadedUpdate,
	type PreparedUpdateHandle,
	predownloadUpdate,
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
