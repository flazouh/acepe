export interface ProviderUsageRefreshSchedulerOptions {
	readonly isStartupReady: () => boolean;
	readonly refresh: () => void;
	readonly setTimeout: (callback: () => void, delayMs: number) => number;
	readonly clearTimeout: (id: number) => void;
	readonly setInterval: (callback: () => void, delayMs: number) => number;
	readonly clearInterval: (id: number) => void;
	readonly startupPollMs: number;
	readonly initialDelayMs: number;
	readonly eventDebounceMs: number;
	readonly refreshIntervalMs: number;
}

export interface ProviderUsageRefreshScheduler {
	readonly start: () => void;
	readonly notifyUsageUpdated: () => void;
	readonly dispose: () => void;
}

export function createProviderUsageRefreshScheduler(
	options: ProviderUsageRefreshSchedulerOptions
): ProviderUsageRefreshScheduler {
	let disposed = false;
	let started = false;
	let ready = false;
	let startupPollTimeout: number | null = null;
	let initialRefreshTimeout: number | null = null;
	let eventRefreshTimeout: number | null = null;
	let refreshInterval: number | null = null;

	function clearTimeoutIfPresent(id: number | null): void {
		if (id !== null) {
			options.clearTimeout(id);
		}
	}

	function refreshNow(): void {
		if (disposed) {
			return;
		}
		options.refresh();
	}

	function startInterval(): void {
		if (refreshInterval !== null) {
			return;
		}
		refreshInterval = options.setInterval(refreshNow, options.refreshIntervalMs);
	}

	function scheduleInitialRefresh(): void {
		initialRefreshTimeout = options.setTimeout(() => {
			initialRefreshTimeout = null;
			ready = true;
			refreshNow();
			startInterval();
		}, options.initialDelayMs);
	}

	function waitForStartup(): void {
		startupPollTimeout = null;
		if (disposed) {
			return;
		}
		if (!options.isStartupReady()) {
			startupPollTimeout = options.setTimeout(waitForStartup, options.startupPollMs);
			return;
		}
		scheduleInitialRefresh();
	}

	return {
		start: () => {
			if (started) {
				return;
			}
			started = true;
			waitForStartup();
		},
		notifyUsageUpdated: () => {
			if (!ready || disposed) {
				return;
			}
			clearTimeoutIfPresent(eventRefreshTimeout);
			eventRefreshTimeout = options.setTimeout(() => {
				eventRefreshTimeout = null;
				refreshNow();
			}, options.eventDebounceMs);
		},
		dispose: () => {
			disposed = true;
			clearTimeoutIfPresent(startupPollTimeout);
			clearTimeoutIfPresent(initialRefreshTimeout);
			clearTimeoutIfPresent(eventRefreshTimeout);
			if (refreshInterval !== null) {
				options.clearInterval(refreshInterval);
			}
			startupPollTimeout = null;
			initialRefreshTimeout = null;
			eventRefreshTimeout = null;
			refreshInterval = null;
		},
	};
}
