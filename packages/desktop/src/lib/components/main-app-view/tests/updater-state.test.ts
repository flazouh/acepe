import { describe, expect, it } from "bun:test";

import {
	applyUpdaterDownloadEvent,
	createAvailableUpdaterState,
	createCheckingUpdaterState,
	createDownloadingUpdaterState,
	createInstallingUpdaterState,
	getUpdaterPrimaryAction,
	getUpdaterActionLabel,
	getUpdaterStatusLabel,
	shouldShowUpdateAvailableOverlay,
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

	it("keeps install-in-progress out of the fullscreen updater overlay", () => {
		const installing = createInstallingUpdaterState("1.2.3");

		expect(installing.kind).toBe("installing");
		expect(getUpdaterActionLabel(installing)).toBe("Updating 1.2.3");
		expect(getUpdaterStatusLabel(installing)).toBe("Installing update...");
		expect(shouldShowUpdateAvailableOverlay(installing)).toBe(false);
	});

	it("shows the fullscreen updater overlay while the download is still in progress", () => {
		expect(shouldShowUpdateAvailableOverlay(createDownloadingUpdaterState("1.2.3"))).toBe(true);
	});

	it("uses the dev simulation action when no update payload exists", () => {
		expect(getUpdaterPrimaryAction(true, false)).toBe("simulate");
	});

	it("uses the install action when a real update payload exists", () => {
		expect(getUpdaterPrimaryAction(true, true)).toBe("install");
		expect(getUpdaterPrimaryAction(false, false)).toBe("install");
	});
});
