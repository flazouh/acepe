/**
 * Logger system with toggleable loggers by ID.
 *
 * Allows creating named loggers that can be individually enabled/disabled
 * through a debug panel to avoid polluting the console output.
 */

import type { LoggerId } from "../constants/logger-ids.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogEntry = {
	id: string;
	loggerId: string;
	level: LogLevel;
	message: string;
	timestamp: number;
	data?: unknown;
};

export type LoggerConfig = {
	id: LoggerId | string; // Accept LoggerId from constants or any string for flexibility
	name: string;
	enabled?: boolean;
	level?: LogLevel; // Minimum log level to output
};

function isDevEnvironment(): boolean {
	return typeof import.meta !== "undefined" && Boolean(import.meta.env?.DEV);
}

const DEFAULT_LOG_LEVEL: LogLevel = isDevEnvironment() ? "debug" : "warn";

/**
 * Logger instance for a specific component or feature.
 */
export class Logger {
	private config: LoggerConfig;
	private readonly logManager: LogManager;

	constructor(config: LoggerConfig, logManager: LogManager) {
		this.config = { enabled: true, level: DEFAULT_LOG_LEVEL, ...config };
		this.logManager = logManager;
	}

	/**
	 * Log a debug message.
	 */
	debug(message: string, ...data: unknown[]): void {
		this.log("debug", message, data);
	}

	/**
	 * Log an info message.
	 */
	info(message: string, ...data: unknown[]): void {
		this.log("info", message, data);
	}

	/**
	 * Log a warning message.
	 */
	warn(message: string, ...data: unknown[]): void {
		this.log("warn", message, data);
	}

	/**
	 * Log an error message.
	 */
	error(message: string, ...data: unknown[]): void {
		this.log("error", message, data);
	}

	private log(level: LogLevel, message: string, data: unknown[]): void {
		if (!this.config.enabled) {
			return;
		}

		// Skip debug logging work unless there is an active log subscriber
		// (e.g. debug panel). This prevents high-volume debug logs from
		// saturating the renderer during streaming.
		if (level === "debug" && !this.logManager.hasSubscribers()) {
			return;
		}

		// Check if level is high enough
		const levels: LogLevel[] = ["debug", "info", "warn", "error"];
		const minLevelIndex = levels.indexOf(this.config.level || "debug");
		const currentLevelIndex = levels.indexOf(level);
		if (currentLevelIndex < minLevelIndex) {
			return;
		}

		const entry: LogEntry = {
			id: `${this.config.id}-${Date.now()}-${Math.random()}`,
			loggerId: this.config.id,
			level,
			message,
			timestamp: Date.now(),
			data: data.length > 0 ? (data.length === 1 ? data[0] : data) : undefined,
		};

		this.logManager.addLog(entry);

		// Output to console with appropriate method
		const prefix = `[${this.config.name}]`;
		const args = data.length > 0 ? [prefix, message, ...data] : [prefix, message];

		switch (level) {
			case "debug":
				console.debug(...args);
				break;
			case "info":
				console.info(...args);
				break;
			case "warn":
				console.warn(...args);
				break;
			case "error":
				console.error(...args);
				break;
		}
	}

	/**
	 * Check if this logger is enabled.
	 */
	get enabled(): boolean {
		return this.config.enabled ?? true;
	}

	/**
	 * Check if a specific log level is enabled.
	 * Useful for avoiding expensive argument construction when logging is disabled.
	 *
	 * @example
	 * ```typescript
	 * if (logger.isLevelEnabled('debug')) {
	 *   logger.debug('Items:', items.map(i => ({ id: i.id, name: i.name })));
	 * }
	 * ```
	 */
	isLevelEnabled(level: LogLevel): boolean {
		if (!this.config.enabled) {
			return false;
		}
		const levels: LogLevel[] = ["debug", "info", "warn", "error"];
		const minLevelIndex = levels.indexOf(this.config.level || "debug");
		const currentLevelIndex = levels.indexOf(level);
		return currentLevelIndex >= minLevelIndex;
	}

	/**
	 * Set whether this logger is enabled.
	 */
	set enabled(value: boolean) {
		this.config.enabled = value;
	}

	/**
	 * Get the logger configuration.
	 */
	getConfig(): LoggerConfig {
		return { ...this.config };
	}

	/**
	 * Update the logger configuration.
	 */
	updateConfig(updates: Partial<LoggerConfig>): void {
		this.config = { ...this.config, ...updates };
	}
}

/**
 * Central manager for all loggers.
 */
class LogManager {
	private readonly loggers = new Map<string, Logger>();
	private logs: LogEntry[] = [];
	private readonly maxLogs = 1000; // Keep last 1000 logs
	private readonly listeners = new Set<(logs: LogEntry[]) => void>();

	/**
	 * Create a new logger.
	 */
	createLogger(config: LoggerConfig): Logger {
		const logger = new Logger(config, this);
		this.loggers.set(config.id, logger);
		return logger;
	}

	/**
	 * Get a logger by ID.
	 */
	getLogger(id: string): Logger | undefined {
		return this.loggers.get(id);
	}

	/**
	 * Get all loggers.
	 */
	getAllLoggers(): Logger[] {
		return Array.from(this.loggers.values());
	}

	/**
	 * Toggle a logger's enabled state.
	 */
	toggleLogger(id: string, enabled: boolean): void {
		const logger = this.loggers.get(id);
		if (logger) {
			logger.enabled = enabled;
		}
	}

	/**
	 * Add a log entry.
	 */
	addLog(entry: LogEntry): void {
		this.logs.push(entry);
		if (this.logs.length > this.maxLogs) {
			this.logs.shift();
		}
		this.notifyListeners();
	}

	/**
	 * Get all logs.
	 */
	getLogs(): LogEntry[] {
		return [...this.logs];
	}

	/**
	 * Get logs for a specific logger.
	 */
	getLogsForLogger(loggerId: string): LogEntry[] {
		return this.logs.filter((log) => log.loggerId === loggerId);
	}

	/**
	 * Clear all logs.
	 */
	clearLogs(): void {
		this.logs = [];
		this.notifyListeners();
	}

	/**
	 * Subscribe to log updates.
	 */
	subscribe(listener: (logs: LogEntry[]) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	hasSubscribers(): boolean {
		return this.listeners.size > 0;
	}

	private notifyListeners(): void {
		this.listeners.forEach((listener) => listener(this.logs));
	}
}

// Singleton instance
const logManager = new LogManager();

/**
 * Create a new logger.
 *
 * @param config - Logger configuration
 * @returns A new Logger instance
 *
 * @example
 * ```typescript
 * const logger = createLogger({
 *   id: 'model-selector',
 *   name: 'Model Selector'
 * });
 *
 * logger.debug('Model changed', { modelId: 'claude-3.5-sonnet' });
 * ```
 */
export function createLogger(config: LoggerConfig): Logger {
	return logManager.createLogger(config);
}

/**
 * Get a logger by ID.
 */
export function getLogger(id: string): Logger | undefined {
	return logManager.getLogger(id);
}

/**
 * Get all loggers.
 */
export function getAllLoggers(): Logger[] {
	return logManager.getAllLoggers();
}

/**
 * Toggle a logger's enabled state.
 */
export function toggleLogger(id: string, enabled: boolean): void {
	logManager.toggleLogger(id, enabled);
}

/**
 * Get all logs.
 */
export function getLogs(): LogEntry[] {
	return logManager.getLogs();
}

/**
 * Get logs for a specific logger.
 */
export function getLogsForLogger(loggerId: string): LogEntry[] {
	return logManager.getLogsForLogger(loggerId);
}

/**
 * Clear all logs.
 */
export function clearLogs(): void {
	logManager.clearLogs();
}

/**
 * Subscribe to log updates.
 */
export function subscribeToLogs(listener: (logs: LogEntry[]) => void): () => void {
	return logManager.subscribe(listener);
}
