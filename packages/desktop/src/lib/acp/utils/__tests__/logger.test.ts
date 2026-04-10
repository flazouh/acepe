import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { __createLoggerHarnessForTests } from "../logger.js";

type ConsoleCall = {
	method: "debug" | "info" | "warn" | "error";
	args: unknown[];
};

describe("logger", () => {
	let monotonicNow = 0;
	let wallClockNow = 1_700_000_000_000;
	let consoleCalls: ConsoleCall[] = [];
	let harness: ReturnType<typeof __createLoggerHarnessForTests>;

	const consoleApi = {
		debug: (...data: unknown[]) => {
			consoleCalls.push({ method: "debug", args: data });
		},
		info: (...data: unknown[]) => {
			consoleCalls.push({ method: "info", args: data });
		},
		warn: (...data: unknown[]) => {
			consoleCalls.push({ method: "warn", args: data });
		},
		error: (...data: unknown[]) => {
			consoleCalls.push({ method: "error", args: data });
		},
	};

	beforeEach(() => {
		harness = __createLoggerHarnessForTests();
		monotonicNow = 0;
		wallClockNow = 1_700_000_000_000;
		consoleCalls = [];
		harness.configureRuntime({
			monotonicNow: () => monotonicNow,
			wallClockNow: () => wallClockNow,
			consoleApi,
			shouldUseStyledConsole: () => true,
		});
		harness.reset();
	});

	afterEach(() => {
		harness.restoreRuntimeDefaults();
	});

	it("records global and per-logger timing metadata", () => {
		const primaryLogger = harness.createLogger({ id: "primary", name: "Primary", level: "info" });
		const secondaryLogger = harness.createLogger({
			id: "secondary",
			name: "Secondary",
			level: "info",
		});

		monotonicNow = 25;
		wallClockNow += 25;
		primaryLogger.info("First event");

		monotonicNow = 210;
		wallClockNow += 185;
		primaryLogger.info("Second event");

		monotonicNow = 350;
		wallClockNow += 140;
		secondaryLogger.warn("Other logger");

		const logs = harness.getLogs();
		expect(logs).toHaveLength(3);
		expect(logs[0]?.timing).toEqual({
			sinceStartMs: 25,
			sinceLastLogMs: null,
			sinceLoggerLogMs: null,
		});
		expect(logs[1]?.timing).toEqual({
			sinceStartMs: 210,
			sinceLastLogMs: 185,
			sinceLoggerLogMs: 185,
		});
		expect(logs[2]?.timing).toEqual({
			sinceStartMs: 350,
			sinceLastLogMs: 140,
			sinceLoggerLogMs: null,
		});
	});

	it("formats styled dev console output with timing badges", () => {
		const logger = harness.createLogger({
			id: "provider-store",
			name: "ProviderStore",
			level: "info",
		});
		const payload = { count: 3 };

		monotonicNow = 50;
		wallClockNow += 50;
		logger.info("Providers loaded", payload);

		expect(consoleCalls).toHaveLength(1);
		expect(consoleCalls[0]?.method).toBe("info");
		const formattedMessage = consoleCalls[0]?.args[0];
		expect(typeof formattedMessage).toBe("string");
		if (typeof formattedMessage !== "string") {
			throw new Error("expected formatted message to be a string");
		}
		expect(formattedMessage).toContain("%cINFO%c");
		expect(formattedMessage).toContain("Providers loaded");
		expect(formattedMessage).toContain("T+50ms");
		expect(consoleCalls[0]?.args.at(-1)).toEqual(payload);
	});

	it("falls back to plain console output when styled logs are disabled", () => {
		harness.configureRuntime({
			shouldUseStyledConsole: () => false,
		});

		const logger = harness.createLogger({ id: "plain", name: "PlainLogger", level: "warn" });
		monotonicNow = 80;
		wallClockNow += 80;
		logger.warn("Plain output");

		expect(consoleCalls).toHaveLength(1);
		expect(consoleCalls[0]?.method).toBe("warn");
		const prefix = consoleCalls[0]?.args[0];
		expect(typeof prefix).toBe("string");
		if (typeof prefix !== "string") {
			throw new Error("expected plain prefix to be a string");
		}
		expect(prefix).toContain("[WARN");
		expect(prefix).not.toContain("%c");
		expect(consoleCalls[0]?.args[1]).toBe("Plain output");
	});
});
