import { describe, expect, it } from "bun:test";
import type { Project } from "../../logic/project-manager.svelte.js";

import {
	buildProjectSelectionCardDataList,
	createProjectSelectionMetadataScheduler,
	getProjectSelectionModifierSymbol,
	getProjectSelectionPathsKey,
	getProjectSelectionShortcutIndex,
	getSelectableProjectByIndex,
	isProjectSelectionTextInputTarget,
	shouldSyncProjectSelectionMetadata,
} from "../project-selection-panel-state.js";

const projects = [
	{ path: "/repo/a", name: "A" },
	{ path: "/repo/b", name: "B" },
] as const;

function createProject(path: string, name: string): Project {
	return {
		path,
		name,
		createdAt: new Date("2024-01-01T00:00:00.000Z"),
		color: "#123456",
	};
}

describe("project selection panel state", () => {
	it("uses a platform-specific shortcut modifier label", () => {
		expect(getProjectSelectionModifierSymbol("MacIntel")).toBe("⌘");
		expect(getProjectSelectionModifierSymbol("Linux x86_64")).toBe("Ctrl");
		expect(getProjectSelectionModifierSymbol(undefined)).toBe("Ctrl");
	});

	it("builds a stable project paths key", () => {
		expect(getProjectSelectionPathsKey(projects)).toBe("/repo/a\n/repo/b");
	});

	it("detects text input keyboard targets", () => {
		const input = { tagName: "INPUT" } as unknown as EventTarget;
		const textarea = { tagName: "TEXTAREA" } as unknown as EventTarget;
		const button = { tagName: "BUTTON" } as unknown as EventTarget;

		expect(isProjectSelectionTextInputTarget(input)).toBe(true);
		expect(isProjectSelectionTextInputTarget(textarea)).toBe(true);
		expect(isProjectSelectionTextInputTarget(button)).toBe(false);
		expect(isProjectSelectionTextInputTarget(null)).toBe(false);
	});

	it("resolves numeric shortcut indexes only for the correct modifier", () => {
		expect(
			getProjectSelectionShortcutIndex({
				key: "2",
				isMac: true,
				metaKey: true,
				ctrlKey: false,
				altKey: false,
				shiftKey: false,
			})
		).toBe(1);
		expect(
			getProjectSelectionShortcutIndex({
				key: "2",
				isMac: false,
				metaKey: false,
				ctrlKey: true,
				altKey: false,
				shiftKey: false,
			})
		).toBe(1);
		expect(
			getProjectSelectionShortcutIndex({
				key: "2",
				isMac: true,
				metaKey: false,
				ctrlKey: true,
				altKey: false,
				shiftKey: false,
			})
		).toBeNull();
		expect(
			getProjectSelectionShortcutIndex({
				key: "0",
				isMac: true,
				metaKey: true,
				ctrlKey: false,
				altKey: false,
				shiftKey: false,
			})
		).toBeNull();
	});

	it("returns selectable projects and skips missing ones", () => {
		expect(
			getSelectableProjectByIndex({
				projects,
				index: 0,
				missingProjectPaths: new Set(),
			})
		).toBe(projects[0]);
		expect(
			getSelectableProjectByIndex({
				projects,
				index: 1,
				missingProjectPaths: new Set(["/repo/b"]),
			})
		).toBeNull();
		expect(
			getSelectableProjectByIndex({
				projects,
				index: 5,
				missingProjectPaths: new Set(),
			})
		).toBeNull();
	});

	it("syncs metadata for changed visible projects or retryable metadata", () => {
		expect(
			shouldSyncProjectSelectionMetadata({
				displayProjectsKey: "a",
				lastDisplayProjectsKey: "a",
				hasRetryableMetadata: false,
			})
		).toBe(false);
		expect(
			shouldSyncProjectSelectionMetadata({
				displayProjectsKey: "b",
				lastDisplayProjectsKey: "a",
				hasRetryableMetadata: false,
			})
		).toBe(true);
		expect(
			shouldSyncProjectSelectionMetadata({
				displayProjectsKey: "a",
				lastDisplayProjectsKey: "a",
				hasRetryableMetadata: true,
			})
		).toBe(true);
	});

	it("schedules project metadata after delay and idle time", () => {
		const delayedCallbacks: Array<() => void> = [];
		const idleCallbacks: Array<() => void> = [];
		let runCount = 0;
		const schedule = createProjectSelectionMetadataScheduler({
			delayMs: 120,
			idleTimeoutMs: 80,
			scheduleDelay(callback, delayMs) {
				expect(delayMs).toBe(120);
				delayedCallbacks.push(callback);
				return () => undefined;
			},
			scheduleIdle(callback, timeoutMs) {
				expect(timeoutMs).toBe(80);
				idleCallbacks.push(callback);
				return () => undefined;
			},
		});

		schedule(() => {
			runCount += 1;
		});

		expect(runCount).toBe(0);
		expect(idleCallbacks).toHaveLength(0);

		delayedCallbacks[0]?.();
		expect(runCount).toBe(0);
		expect(idleCallbacks).toHaveLength(1);

		idleCallbacks[0]?.();
		expect(runCount).toBe(1);
	});

	it("cancels scheduled project metadata before it reaches git work", () => {
		const delayedCallbacks: Array<() => void> = [];
		const idleCallbacks: Array<() => void> = [];
		let delayCancelled = 0;
		let idleCancelled = 0;
		let runCount = 0;
		const schedule = createProjectSelectionMetadataScheduler({
			scheduleDelay(callback) {
				delayedCallbacks.push(callback);
				return () => {
					delayCancelled += 1;
				};
			},
			scheduleIdle(callback) {
				idleCallbacks.push(callback);
				return () => {
					idleCancelled += 1;
				};
			},
		});

		const cancel = schedule(() => {
			runCount += 1;
		});
		cancel();
		delayedCallbacks[0]?.();
		idleCallbacks[0]?.();

		expect(delayCancelled).toBe(1);
		expect(idleCancelled).toBe(0);
		expect(runCount).toBe(0);
	});

	it("builds project card data from live, cached, and remote metadata", () => {
		const projectA = createProject("/repo/a", "A");
		const projectB = createProject("/repo/b", "B");
		const liveGitStatus = [
			{ path: "a.ts", status: "modified", insertions: 2, deletions: 1 },
		] as const;
		const cachedGitStatus = [
			{ path: "b.ts", status: "added", insertions: 3, deletions: 0 },
		] as const;

		const cardData = buildProjectSelectionCardDataList({
			displayProjects: [projectA, projectB],
			cardDataByPath: new Map([
				[
					"/repo/a",
					{
						branch: "main",
						gitStatus: liveGitStatus,
					},
				],
			]),
			getCachedMetadata: (projectPath) =>
				projectPath === "/repo/b"
					? {
							branch: "feature",
							gitStatus: cachedGitStatus,
						}
					: null,
			remoteStatusByPath: new Map([
				[
					"/repo/a",
					{
						ahead: 2,
						behind: 1,
					},
				],
			]),
		});

		expect(cardData).toEqual([
			{
				project: projectA,
				branch: "main",
				gitStatus: liveGitStatus,
				ahead: 2,
				behind: 1,
			},
			{
				project: projectB,
				branch: "feature",
				gitStatus: cachedGitStatus,
				ahead: null,
				behind: null,
			},
		]);
	});
});
