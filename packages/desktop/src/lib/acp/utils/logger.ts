/**
 * Logger system with toggleable loggers by ID.
 *
 * Allows creating named loggers that can be individually enabled/disabled
 * through a debug panel to avoid polluting the console output.
 */

import type { LoggerId } from "../constants/logger-ids.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogTiming = {
	sinceStartMs: number;
	sinceLastLogMs: number | null;
	sinceLoggerLogMs: number | null;
};

export type LogEntry = {
	id: string;
	loggerId: string;
	level: LogLevel;
	message: string;
	timestamp: number;
	timing: LogTiming;
	data?: unknown;
};

export type LoggerConfig = {
	id: LoggerId | string;
	name: string;
	enabled?: boolean;
	level?: LogLevel;
};

type ConsoleApi = {
	debug: (...data: unknown[]) => void;
	info: (...data: unknown[]) => void;
	warn: (...data: unknown[]) => void;
	error: (...data: unknown[]) => void;
};

type LoggerRuntime = {
	wallClockNow: () => number;
	monotonicNow: () => number;
	consoleApi: ConsoleApi;
	shouldUseStyledConsole: () => boolean;
};

type LoggerRuntimeOverrides = {
	wallClockNow?: () => number;
	monotonicNow?: () => number;
	consoleApi?: ConsoleApi;
	shouldUseStyledConsole?: () => boolean;
};

const MONOSPACE_FONT_STACK =
	"ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace";
const LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

function isDevEnvironment(): boolean {
	return typeof import.meta !== "undefined" && Boolean(import.meta.env?.DEV);
}

function getMonotonicNow(): number {
	if (typeof performance !== "undefined" && typeof performance.now === "function") {
		return performance.now();
	}

	return Date.now();
}

const defaultLoggerRuntime: LoggerRuntime = {
	wallClockNow: () => Date.now(),
	monotonicNow: () => getMonotonicNow(),
	consoleApi: console,
	shouldUseStyledConsole: () => isDevEnvironment() && typeof window !== "undefined",
};

const loggerRuntime: LoggerRuntime = {
	wallClockNow: defaultLoggerRuntime.wallClockNow,
	monotonicNow: defaultLoggerRuntime.monotonicNow,
	consoleApi: defaultLoggerRuntime.consoleApi,
	shouldUseStyledConsole: defaultLoggerRuntime.shouldUseStyledConsole,
};

const DEFAULT_LOG_LEVEL: LogLevel = isDevEnvironment() ? "debug" : "warn";

function restoreLoggerRuntimeDefaults(): void {
	loggerRuntime.wallClockNow = defaultLoggerRuntime.wallClockNow;
	loggerRuntime.monotonicNow = defaultLoggerRuntime.monotonicNow;
	loggerRuntime.consoleApi = defaultLoggerRuntime.consoleApi;
	loggerRuntime.shouldUseStyledConsole = defaultLoggerRuntime.shouldUseStyledConsole;
}

function getLevelIndex(level: LogLevel): number {
	return LOG_LEVELS.indexOf(level);
}

function createLogDataValue(data: readonly unknown[]): unknown {
	if (data.length === 0) {
		return undefined;
	}

	if (data.length === 1) {
		return data[0];
	}

	return data.slice();
}

function appendLogData(args: unknown[], data: readonly unknown[]): void {
	for (const item of data) {
		args.push(item);
	}
}

function padNumber(value: number, length: number): string {
	return value.toString().padStart(length, "0");
}

function formatClockTime(timestamp: number): string {
	const date = new Date(timestamp);
	return `${padNumber(date.getHours(), 2)}:${padNumber(date.getMinutes(), 2)}:${padNumber(date.getSeconds(), 2)}.${padNumber(date.getMilliseconds(), 3)}`;
}

function formatDuration(durationMs: number): string {
	const roundedDurationMs = Math.max(0, Math.round(durationMs));

	if (roundedDurationMs < 1000) {
		return `${roundedDurationMs}ms`;
	}

	if (roundedDurationMs < 60_000) {
		const seconds = roundedDurationMs / 1000;
		return seconds < 10 ? `${seconds.toFixed(2)}s` : `${seconds.toFixed(1)}s`;
	}

	const totalSeconds = Math.round(roundedDurationMs / 1000);
	if (totalSeconds < 3600) {
		const minutes = Math.floor(totalSeconds / 60);
		const seconds = totalSeconds % 60;
		return `${minutes}m${padNumber(seconds, 2)}s`;
	}

	const totalMinutes = Math.floor(totalSeconds / 60);
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	return `${hours}h${padNumber(minutes, 2)}m`;
}

function formatDeltaLabel(durationMs: number | null): string {
	if (durationMs === null) {
		return "start";
	}

	return `+${formatDuration(durationMs)}`;
}

function formatTotalLabel(durationMs: number): string {
	return `T+${formatDuration(durationMs)}`;
}

function getLevelBadgeStyle(level: LogLevel): string {
	switch (level) {
		case "debug":
			return "background:#334155;color:#e2e8f0;padding:2px 8px;border-radius:999px;font-weight:700;";
		case "info":
			return "background:#0f766e;color:#ecfeff;padding:2px 8px;border-radius:999px;font-weight:700;";
		case "warn":
			return "background:#d97706;color:#fff7ed;padding:2px 8px;border-radius:999px;font-weight:700;";
		case "error":
			return "background:#dc2626;color:#fef2f2;padding:2px 8px;border-radius:999px;font-weight:700;";
	}
}

function stringToHue(value: string): number {
	let hash = 0;
	for (let index = 0; index < value.length; index += 1) {
		hash = (hash * 31 + value.charCodeAt(index)) % 360;
	}

	return hash;
}

function getLoggerBadgeStyle(loggerId: string): string {
	const hue = stringToHue(loggerId);
	return `background:hsla(${hue}, 80%, 45%, 0.18);color:hsl(${hue}, 90%, 70%);padding:2px 8px;border-radius:999px;font-weight:700;`;
}

function createStyledConsoleArguments(
	level: LogLevel,
	loggerId: string,
	loggerName: string,
	message: string,
	timestamp: number,
	timing: LogTiming,
	data: readonly unknown[]
): unknown[] {
	const formattedMessage =
		`%c${level.toUpperCase()}%c ` +
		`%c${formatClockTime(timestamp)}%c ` +
		`%c${formatDeltaLabel(timing.sinceLastLogMs)}%c ` +
		`%c${formatTotalLabel(timing.sinceStartMs)}%c ` +
		`%c${loggerName}%c ` +
		message;
	const args: unknown[] = [
		formattedMessage,
		getLevelBadgeStyle(level),
		"",
		`color:#94a3b8;font-family:${MONOSPACE_FONT_STACK};font-weight:600;`,
		"",
		`color:#22c55e;font-family:${MONOSPACE_FONT_STACK};font-weight:700;`,
		"",
		`color:#c084fc;font-family:${MONOSPACE_FONT_STACK};font-weight:700;`,
		"",
		getLoggerBadgeStyle(loggerId),
		"",
	];

	appendLogData(args, data);
	return args;
}

function createPlainConsoleArguments(
	level: LogLevel,
	loggerName: string,
	message: string,
	timestamp: number,
	timing: LogTiming,
	data: readonly unknown[]
): unknown[] {
	const prefix =
		`[${level.toUpperCase()} ` +
		`${formatClockTime(timestamp)} ` +
		`${formatDeltaLabel(timing.sinceLastLogMs)} ` +
		`${formatTotalLabel(timing.sinceStartMs)} ` +
		`${loggerName}]`;
	const args: unknown[] = [prefix, message];
	appendLogData(args, data);
	return args;
}

function createLoggerConfig(config: LoggerConfig): LoggerConfig {
	return {
		id: config.id,
		name: config.name,
		enabled: config.enabled ?? true,
		level: config.level ?? DEFAULT_LOG_LEVEL,
	};
}

/**
 * Logger instance for a specific component or feature.
 */
export class Logger {
	private config: LoggerConfig;
	private readonly logManager: LogManager;

	constructor(config: LoggerConfig, logManager: LogManager) {
		this.config = createLoggerConfig(config);
		this.logManager = logManager;
	}

	debug(message: string, ...data: unknown[]): void {
		this.log("debug", message, data);
	}

	info(message: string, ...data: unknown[]): void {
		this.log("info", message, data);
	}

	warn(message: string, ...data: unknown[]): void {
		this.log("warn", message, data);
	}

	error(message: string, ...data: unknown[]): void {
		this.log("error", message, data);
	}

	private log(level: LogLevel, message: string, data: readonly unknown[]): void {
		if (!this.config.enabled) {
			return;
		}

		if (level === "debug" && !this.logManager.hasSubscribers()) {
			return;
		}

		const minLevel = this.config.level ?? DEFAULT_LOG_LEVEL;
		if (getLevelIndex(level) < getLevelIndex(minLevel)) {
			return;
		}

		const timestamp = this.logManager.getRuntime().wallClockNow();
		const timing = this.logManager.captureTiming(this.config.id);
		const entry: LogEntry = {
			id: `${this.config.id}-${timestamp}-${Math.random()}`,
			loggerId: this.config.id,
			level,
			message,
			timestamp,
			timing,
			data: createLogDataValue(data),
		};

		this.logManager.addLog(entry);
		this.writeToConsole(level, entry, data);
	}

	private writeToConsole(level: LogLevel, entry: LogEntry, data: readonly unknown[]): void {
		const runtime = this.logManager.getRuntime();
		const consoleMethod = runtime.consoleApi[level];
		const consoleArguments = runtime.shouldUseStyledConsole()
			? createStyledConsoleArguments(
					level,
					entry.loggerId,
					this.config.name,
					entry.message,
					entry.timestamp,
					entry.timing,
					data
				)
			: createPlainConsoleArguments(
					level,
					this.config.name,
					entry.message,
					entry.timestamp,
					entry.timing,
					data
				);

		consoleMethod.apply(runtime.consoleApi, consoleArguments);
	}

	get enabled(): boolean {
		return this.config.enabled ?? true;
	}

	isLevelEnabled(level: LogLevel): boolean {
		if (!this.config.enabled) {
			return false;
		}

		const minLevel = this.config.level ?? DEFAULT_LOG_LEVEL;
		return getLevelIndex(level) >= getLevelIndex(minLevel);
	}

	set enabled(value: boolean) {
		this.config.enabled = value;
	}

	getConfig(): LoggerConfig {
		return {
			id: this.config.id,
			name: this.config.name,
			enabled: this.config.enabled,
			level: this.config.level,
		};
	}

	updateConfig(updates: Partial<LoggerConfig>): void {
		this.config = {
			id: updates.id ?? this.config.id,
			name: updates.name ?? this.config.name,
			enabled: updates.enabled ?? this.config.enabled,
			level: updates.level ?? this.config.level,
		};
	}
}

/**
 * Central manager for all loggers.
 */
class LogManager {
	private readonly loggers = new Map<string, Logger>();
	private logs: LogEntry[] = [];
	private readonly maxLogs = 1000;
	private readonly listeners = new Set<(logs: LogEntry[]) => void>();
	private sessionStartMonotonicMs: number;
	private lastLogMonotonicMs: number | null = null;
	private readonly loggerLastLogMonotonicMs = new Map<string, number>();

	constructor(private readonly runtime: LoggerRuntime = loggerRuntime) {
		this.sessionStartMonotonicMs = runtime.monotonicNow();
	}

	createLogger(config: LoggerConfig): Logger {
		const logger = new Logger(config, this);
		this.loggers.set(config.id, logger);
		return logger;
	}

	getLogger(id: string): Logger | undefined {
		return this.loggers.get(id);
	}

	getAllLoggers(): Logger[] {
		return Array.from(this.loggers.values());
	}

	toggleLogger(id: string, enabled: boolean): void {
		const logger = this.loggers.get(id);
		if (logger) {
			logger.enabled = enabled;
		}
	}

	addLog(entry: LogEntry): void {
		this.logs.push(entry);
		if (this.logs.length > this.maxLogs) {
			this.logs.shift();
		}
		this.notifyListeners();
	}

	captureTiming(loggerId: string): LogTiming {
		const now = this.runtime.monotonicNow();
		const previousGlobalLog = this.lastLogMonotonicMs;
		const previousLoggerLog = this.loggerLastLogMonotonicMs.get(loggerId);

		this.lastLogMonotonicMs = now;
		this.loggerLastLogMonotonicMs.set(loggerId, now);

		return {
			sinceStartMs: Math.max(0, now - this.sessionStartMonotonicMs),
			sinceLastLogMs: previousGlobalLog === null ? null : Math.max(0, now - previousGlobalLog),
			sinceLoggerLogMs:
				previousLoggerLog === undefined ? null : Math.max(0, now - previousLoggerLog),
		};
	}

	getLogs(): LogEntry[] {
		return this.logs.slice();
	}

	getLogsForLogger(loggerId: string): LogEntry[] {
		return this.logs.filter((log) => log.loggerId === loggerId);
	}

	clearLogs(): void {
		this.logs = [];
		this.notifyListeners();
	}

	subscribe(listener: (logs: LogEntry[]) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	hasSubscribers(): boolean {
		return this.listeners.size > 0;
	}

	resetForTests(): void {
		this.loggers.clear();
		this.logs = [];
		this.listeners.clear();
		this.lastLogMonotonicMs = null;
		this.loggerLastLogMonotonicMs.clear();
		this.sessionStartMonotonicMs = this.runtime.monotonicNow();
	}

	getRuntime(): LoggerRuntime {
		return this.runtime;
	}

	private notifyListeners(): void {
		for (const listener of this.listeners) {
			listener(this.logs);
		}
	}
}

const logManager = new LogManager();

export function createLogger(config: LoggerConfig): Logger {
	return logManager.createLogger(config);
}

export function getLogger(id: string): Logger | undefined {
	return logManager.getLogger(id);
}

export function getAllLoggers(): Logger[] {
	return logManager.getAllLoggers();
}

export function toggleLogger(id: string, enabled: boolean): void {
	logManager.toggleLogger(id, enabled);
}

export function getLogs(): LogEntry[] {
	return logManager.getLogs();
}

export function getLogsForLogger(loggerId: string): LogEntry[] {
	return logManager.getLogsForLogger(loggerId);
}

export function clearLogs(): void {
	logManager.clearLogs();
}

export function subscribeToLogs(listener: (logs: LogEntry[]) => void): () => void {
	return logManager.subscribe(listener);
}

export function __configureLoggerRuntimeForTests(overrides: LoggerRuntimeOverrides): void {
	if (overrides.wallClockNow) {
		loggerRuntime.wallClockNow = overrides.wallClockNow;
	}

	if (overrides.monotonicNow) {
		loggerRuntime.monotonicNow = overrides.monotonicNow;
	}

	if (overrides.consoleApi) {
		loggerRuntime.consoleApi = overrides.consoleApi;
	}

	if (overrides.shouldUseStyledConsole) {
		loggerRuntime.shouldUseStyledConsole = overrides.shouldUseStyledConsole;
	}
}

export function __resetLoggerStateForTests(): void {
	logManager.resetForTests();
}

export function __restoreLoggerRuntimeDefaultsForTests(): void {
	restoreLoggerRuntimeDefaults();
	logManager.resetForTests();
}

export type LoggerTestHarness = {
	createLogger: (config: LoggerConfig) => Logger;
	getLogs: () => LogEntry[];
	configureRuntime: (overrides: LoggerRuntimeOverrides) => void;
	restoreRuntimeDefaults: () => void;
	reset: () => void;
};

export function __createLoggerHarnessForTests(): LoggerTestHarness {
	const runtime: LoggerRuntime = {
		wallClockNow: defaultLoggerRuntime.wallClockNow,
		monotonicNow: defaultLoggerRuntime.monotonicNow,
		consoleApi: defaultLoggerRuntime.consoleApi,
		shouldUseStyledConsole: defaultLoggerRuntime.shouldUseStyledConsole,
	};
	const manager = new LogManager(runtime);

	return {
		createLogger: (config) => manager.createLogger(config),
		getLogs: () => manager.getLogs(),
		configureRuntime: (overrides) => {
			if (overrides.wallClockNow) {
				runtime.wallClockNow = overrides.wallClockNow;
			}
			if (overrides.monotonicNow) {
				runtime.monotonicNow = overrides.monotonicNow;
			}
			if (overrides.consoleApi) {
				runtime.consoleApi = overrides.consoleApi;
			}
			if (overrides.shouldUseStyledConsole) {
				runtime.shouldUseStyledConsole = overrides.shouldUseStyledConsole;
			}
		},
		restoreRuntimeDefaults: () => {
			runtime.wallClockNow = defaultLoggerRuntime.wallClockNow;
			runtime.monotonicNow = defaultLoggerRuntime.monotonicNow;
			runtime.consoleApi = defaultLoggerRuntime.consoleApi;
			runtime.shouldUseStyledConsole = defaultLoggerRuntime.shouldUseStyledConsole;
			manager.resetForTests();
		},
		reset: () => manager.resetForTests(),
	};
}
