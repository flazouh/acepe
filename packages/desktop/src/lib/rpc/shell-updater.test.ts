import { describe, expect, it } from "bun:test";
import type { DownloadEvent } from "$lib/utils/updater-types.js";
import {
	downloadEventsForProgress,
	readAppVersionResponse,
	readCheckForUpdateResponse,
	readUpdateProgressResponse,
	readUpdateWorkResponse,
	requestAppVersion,
	requestRelaunch,
	requestUpdate,
	runShellDownload,
	startDownloadReportCursor,
	type ShellUpdaterRequests,
} from "./shell-updater.ts";

type ShellAnswers = Partial<Record<keyof ShellUpdaterRequests, () => Promise<unknown>>>;

const shellThat = (
	answers: ShellAnswers
): { readonly requests: ShellUpdaterRequests; readonly calls: Array<string> } => {
	const calls: Array<string> = [];
	const answer = (name: keyof ShellUpdaterRequests, fallback: unknown) => () => {
		calls.push(name);
		const given = answers[name];
		return given === undefined ? Promise.resolve(fallback) : given();
	};
	return {
		requests: {
			getAppVersion: answer("getAppVersion", { version: null, channel: null }),
			checkForUpdate: answer("checkForUpdate", { version: null, error: null }),
			downloadUpdate: answer("downloadUpdate", { ok: true, error: null }),
			applyUpdate: answer("applyUpdate", { ok: true, error: null }),
			updateDownloadProgress: answer("updateDownloadProgress", {
				downloadedBytes: 0,
				totalBytes: null,
			}),
			relaunchApp: answer("relaunchApp", { ok: true, error: null }),
		},
		calls,
	};
};

// The download poller never fires on its own in a test. Every poll is one
// explicit tick, so the reported events are the ones the test asked for.
const manualTimers = (): {
	readonly timers: Parameters<typeof runShellDownload>[2];
	readonly tick: () => void;
	readonly cleared: () => boolean;
} => {
	let handler: (() => void) | null = null;
	let stopped = false;
	return {
		timers: {
			setInterval: (next) => {
				handler = next;
				return 1 as unknown as ReturnType<typeof setInterval>;
			},
			clearInterval: () => {
				stopped = true;
			},
		},
		tick: () => {
			handler?.();
		},
		cleared: () => stopped,
	};
};

describe("reading shell updater answers", () => {
	it("reads the version out of the shell answer", () => {
		expect(readAppVersionResponse({ version: "2026.3.33", channel: "stable" })).toBe(
			"2026.3.33"
		);
	});

	it("reads no version when the shell could not find one", () => {
		expect(readAppVersionResponse({ version: null, channel: null })).toBeNull();
		expect(readAppVersionResponse({ version: "" })).toBeNull();
		expect(readAppVersionResponse(undefined)).toBeNull();
	});

	it("reads an available update", () => {
		expect(readCheckForUpdateResponse({ version: "2026.4.4", error: null })).toEqual({
			kind: "available",
			version: "2026.4.4",
		});
	});

	it("reads no update", () => {
		expect(readCheckForUpdateResponse({ version: null, error: null })).toEqual({
			kind: "none",
		});
	});

	it("reads a failed check", () => {
		expect(
			readCheckForUpdateResponse({ version: null, error: "Failed to fetch update info" })
		).toEqual({ kind: "failed", message: "Failed to fetch update info" });
	});

	it("treats an unreadable answer as a failed check, never as no update", () => {
		expect(readCheckForUpdateResponse(undefined).kind).toBe("failed");
	});

	it("reads the failure reason off a refused update request", () => {
		expect(readUpdateWorkResponse({ ok: false, error: "patch chain broke" })).toBe(
			"patch chain broke"
		);
		expect(readUpdateWorkResponse({ ok: true, error: null })).toBeNull();
		expect(readUpdateWorkResponse({ ok: false, error: null })).toBe(
			"the shell refused the update request"
		);
	});

	it("reads the download byte counts", () => {
		expect(readUpdateProgressResponse({ downloadedBytes: 12, totalBytes: 40 })).toEqual({
			downloadedBytes: 12,
			totalBytes: 40,
		});
		expect(readUpdateProgressResponse({ downloadedBytes: 12, totalBytes: null })).toEqual({
			downloadedBytes: 12,
			totalBytes: null,
		});
		expect(readUpdateProgressResponse({ totalBytes: 40 })).toBeNull();
	});
});

describe("turning shell byte counts into download events", () => {
	it("announces the size once and then reports the new bytes", () => {
		const first = downloadEventsForProgress(startDownloadReportCursor(), {
			downloadedBytes: 100,
			totalBytes: 400,
		});
		expect(first.events).toEqual([
			{ event: "Started", data: { contentLength: 400 } },
			{ event: "Progress", data: { chunkLength: 100 } },
		]);

		const second = downloadEventsForProgress(first.cursor, {
			downloadedBytes: 250,
			totalBytes: 400,
		});
		expect(second.events).toEqual([{ event: "Progress", data: { chunkLength: 150 } }]);
	});

	it("says nothing when the byte count has not moved", () => {
		const first = downloadEventsForProgress(startDownloadReportCursor(), {
			downloadedBytes: 100,
			totalBytes: 400,
		});
		expect(
			downloadEventsForProgress(first.cursor, { downloadedBytes: 100, totalBytes: 400 }).events
		).toEqual([]);
	});

	it("reports bytes before the shell knows the size", () => {
		const first = downloadEventsForProgress(startDownloadReportCursor(), {
			downloadedBytes: 100,
			totalBytes: null,
		});
		expect(first.events).toEqual([{ event: "Progress", data: { chunkLength: 100 } }]);
	});
});

describe("requestAppVersion", () => {
	it("answers the version the shell read out of the app bundle", async () => {
		const { requests } = shellThat({
			getAppVersion: () => Promise.resolve({ version: "2026.3.33", channel: "stable" }),
		});
		expect(await requestAppVersion(requests)).toBe("2026.3.33");
	});

	it("answers null when the shell request itself fails", async () => {
		const { requests } = shellThat({
			getAppVersion: () => Promise.reject(new Error("rpc timed out")),
		});
		expect(await requestAppVersion(requests)).toBeNull();
	});
});

describe("requestUpdate", () => {
	it("hands back an update when the shell found one", async () => {
		const { requests } = shellThat({
			checkForUpdate: () => Promise.resolve({ version: "2026.4.4", error: null }),
		});
		const update = await requestUpdate(requests);
		expect(update?.version).toBe("2026.4.4");
	});

	it("hands back nothing when the app is already current", async () => {
		const { requests } = shellThat({});
		expect(await requestUpdate(requests)).toBeNull();
	});

	it("rejects when the check failed, so the banner cannot stay on checking", async () => {
		const { requests } = shellThat({
			checkForUpdate: () =>
				Promise.resolve({ version: null, error: "Failed to fetch update info" }),
		});
		expect(requestUpdate(requests)).rejects.toThrow("Failed to fetch update info");
	});

	it("rejects when the shell request itself fails", async () => {
		const { requests } = shellThat({
			checkForUpdate: () => Promise.reject(new Error("rpc timed out")),
		});
		expect(requestUpdate(requests)).rejects.toThrow("rpc timed out");
	});

	it("downloads through the shell and reports the bytes it counted", async () => {
		let downloaded = 0;
		const { requests, calls } = shellThat({
			checkForUpdate: () => Promise.resolve({ version: "2026.4.4", error: null }),
			updateDownloadProgress: () =>
				Promise.resolve({ downloadedBytes: downloaded, totalBytes: 400 }),
		});
		const timers = manualTimers();
		const update = await requestUpdate(requests, timers.timers);
		const events: Array<DownloadEvent> = [];
		const finished = update?.download((event) => {
			events.push(event);
		});
		downloaded = 100;
		timers.tick();
		await finished;
		await Promise.resolve();
		await Promise.resolve();

		expect(calls).toContain("downloadUpdate");
		expect(events).toContainEqual({ event: "Started", data: { contentLength: 400 } });
		expect(events).toContainEqual({ event: "Progress", data: { chunkLength: 100 } });
		expect(events).toContainEqual({ event: "Finished" });
		expect(timers.cleared()).toBe(true);
	});

	it("fails the download when the shell refused it", async () => {
		const { requests } = shellThat({
			checkForUpdate: () => Promise.resolve({ version: "2026.4.4", error: null }),
			downloadUpdate: () => Promise.resolve({ ok: false, error: "patch chain broke" }),
		});
		const timers = manualTimers();
		const update = await requestUpdate(requests, timers.timers);
		expect(update?.download(() => undefined)).rejects.toThrow("patch chain broke");
	});

	it("installs through the shell", async () => {
		const { requests, calls } = shellThat({
			checkForUpdate: () => Promise.resolve({ version: "2026.4.4", error: null }),
		});
		const update = await requestUpdate(requests, manualTimers().timers);
		await update?.install();
		expect(calls).toContain("applyUpdate");
	});
});

describe("requestRelaunch", () => {
	it("asks the shell to relaunch", async () => {
		const { requests, calls } = shellThat({});
		await requestRelaunch(requests);
		expect(calls).toEqual(["relaunchApp"]);
	});
});
