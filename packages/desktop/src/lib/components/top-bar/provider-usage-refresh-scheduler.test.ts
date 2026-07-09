import { describe, expect, test } from "bun:test";

import { createProviderUsageRefreshScheduler } from "./provider-usage-refresh-scheduler.js";

type ScheduledTaskKind = "timeout" | "interval";

interface ScheduledTask {
	readonly id: number;
	readonly kind: ScheduledTaskKind;
	readonly delayMs: number;
	readonly callback: () => void;
	active: boolean;
}

function createFakeTimers() {
	let nextId = 1;
	const tasks: ScheduledTask[] = [];

	function addTask(kind: ScheduledTaskKind, callback: () => void, delayMs: number): number {
		const id = nextId;
		nextId += 1;
		tasks.push({
			id,
			kind,
			delayMs,
			callback,
			active: true,
		});
		return id;
	}

	function clearTask(id: number): void {
		const task = tasks.find((candidate) => candidate.id === id);
		if (task) {
			task.active = false;
		}
	}

	function runNextTimeout(): void {
		const task = tasks.find((candidate) => candidate.kind === "timeout" && candidate.active);
		if (!task) {
			throw new Error("No active timeout to run");
		}
		task.active = false;
		task.callback();
	}

	function activeDelays(kind: ScheduledTaskKind): number[] {
		return tasks
			.filter((candidate) => candidate.kind === kind && candidate.active)
			.map((candidate) => candidate.delayMs);
	}

	return {
		setTimeout: (callback: () => void, delayMs: number) => addTask("timeout", callback, delayMs),
		clearTimeout: clearTask,
		setInterval: (callback: () => void, delayMs: number) => addTask("interval", callback, delayMs),
		clearInterval: clearTask,
		runNextTimeout,
		activeDelays,
	};
}

describe("provider usage refresh scheduler", () => {
	test("waits for startup readiness before the first provider usage refresh", () => {
		const timers = createFakeTimers();
		let startupReady = false;
		let refreshCount = 0;

		const scheduler = createProviderUsageRefreshScheduler({
			isStartupReady: () => startupReady,
			refresh: () => {
				refreshCount += 1;
			},
			setTimeout: timers.setTimeout,
			clearTimeout: timers.clearTimeout,
			setInterval: timers.setInterval,
			clearInterval: timers.clearInterval,
			startupPollMs: 50,
			initialDelayMs: 250,
			eventDebounceMs: 25,
			refreshIntervalMs: 60_000,
		});

		scheduler.start();
		expect(refreshCount).toBe(0);
		expect(timers.activeDelays("timeout")).toEqual([50]);

		timers.runNextTimeout();
		expect(refreshCount).toBe(0);
		expect(timers.activeDelays("timeout")).toEqual([50]);

		startupReady = true;
		timers.runNextTimeout();
		expect(refreshCount).toBe(0);
		expect(timers.activeDelays("timeout")).toEqual([250]);

		timers.runNextTimeout();
		expect(refreshCount).toBe(1);
		expect(timers.activeDelays("interval")).toEqual([60_000]);
	});

	test("ignores usage update events before startup is ready", () => {
		const timers = createFakeTimers();
		let refreshCount = 0;
		const scheduler = createProviderUsageRefreshScheduler({
			isStartupReady: () => false,
			refresh: () => {
				refreshCount += 1;
			},
			setTimeout: timers.setTimeout,
			clearTimeout: timers.clearTimeout,
			setInterval: timers.setInterval,
			clearInterval: timers.clearInterval,
			startupPollMs: 50,
			initialDelayMs: 250,
			eventDebounceMs: 25,
			refreshIntervalMs: 60_000,
		});

		scheduler.start();
		scheduler.notifyUsageUpdated();

		expect(refreshCount).toBe(0);
		expect(timers.activeDelays("timeout")).toEqual([50]);
	});
});
