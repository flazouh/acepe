import { describe, expect, it } from "bun:test";

import {
	applyUpdaterDownloadEvent,
	createAvailableUpdaterState,
	createCheckingUpdaterState,
	createDownloadingUpdaterState,
	createInstallingUpdaterState,
	isUpdaterInstallInProgress,
	getUpdaterPrimaryAction,
	getUpdaterActionLabel,
	getUpdaterStatusLabel,
	shouldShowBlockingUpdaterOverlay,
} from "../logic/updater-state.js";

describe("updater-state", () => {
	it("shows checking label during startup check", () => {
		expect(getUpdaterStatusLabel(createCheckingUpdaterState())).toBe("Checking update...");
	});

	it("shows update pill label with version", () => {
		expect(getUpdaterActionLabel(createAvailableUpdaterState("1.2.3"))).toBe("Update 1.2.3");
	});

	it("tracks download progress in downloading state", () => {
		const started = applyUpdaterDownloadEvent(createDownloadingUpdaterState("1.2.3"), {
			event: "Started",
			data: { contentLength: 100 },
		});
		const progressed = applyUpdaterDownloadEvent(started, {
			event: "Progress",
			data: { chunkLength: 25 },
		});

		expect(getUpdaterActionLabel(progressed)).toBe("Updating 1.2.3");
		expect(getUpdaterStatusLabel(progressed)).toBe("Downloading 25%");
	});

	it("keeps startup update blocking active through install", () => {
		const installing = createInstallingUpdaterState("1.2.3");

		expect(installing.kind).toBe("installing");
		expect(getUpdaterActionLabel(installing)).toBe("Updating 1.2.3");
		expect(getUpdaterStatusLabel(installing)).toBe("Installing update...");
		expect(shouldShowBlockingUpdaterOverlay(installing)).toBe(true);
	});

	it("shows the blocking startup updater overlay while checking and downloading", () => {
		expect(shouldShowBlockingUpdaterOverlay(createCheckingUpdaterState())).toBe(true);
		expect(shouldShowBlockingUpdaterOverlay(createDownloadingUpdaterState("1.2.3"))).toBe(true);
	});

	it("does not treat a completed download as installing before install starts", () => {
		const started = applyUpdaterDownloadEvent(createDownloadingUpdaterState("1.2.3"), {
			event: "Started",
			data: { contentLength: 100 },
		});
		const completedDownload = applyUpdaterDownloadEvent(started, {
			event: "Progress",
			data: { chunkLength: 100 },
		});

		expect(isUpdaterInstallInProgress(completedDownload)).toBe(false);
		expect(isUpdaterInstallInProgress(createInstallingUpdaterState("1.2.3"))).toBe(true);
	});

	it("uses the dev simulation action when no update payload exists", () => {
		expect(getUpdaterPrimaryAction(true, false)).toBe("simulate");
	});

	it("uses the install action when a real update payload exists", () => {
		expect(getUpdaterPrimaryAction(true, true)).toBe("install");
		expect(getUpdaterPrimaryAction(false, false)).toBe("install");
	});
});
