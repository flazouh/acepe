export type HotPathDiagnosticSample = {
	scope: string;
	event: string;
	count: number;
	totalValue: number;
	maxValue: number;
	lastValue: number | null;
};

export type HotPathDiagnosticSnapshot = {
	windowMs: number;
	samples: ReadonlyArray<HotPathDiagnosticSample>;
};

export type HotPathDiagnosticsOptions = {
	intervalMs?: number;
	now?: () => number;
	emit?: (snapshot: HotPathDiagnosticSnapshot) => void;
	isEnabled?: () => boolean;
};

type MutableHotPathDiagnosticSample = {
	scope: string;
	event: string;
	count: number;
	totalValue: number;
	maxValue: number;
	lastValue: number | null;
};

const HOT_PATH_DIAGNOSTICS_STORAGE_KEY = "acepe:hot-path-diagnostics";

function defaultNow(): number {
	if (typeof performance !== "undefined") {
		return performance.now();
	}
	return Date.now();
}

function emitHotPathDiagnosticsToConsole(snapshot: HotPathDiagnosticSnapshot): void {
	console.info("[hot-path]", {
		windowMs: snapshot.windowMs,
		samples: snapshot.samples,
	});
}

export class HotPathDiagnostics {
	private readonly intervalMs: number;
	private readonly now: () => number;
	private readonly emit: (snapshot: HotPathDiagnosticSnapshot) => void;
	private readonly isEnabled: () => boolean;
	private readonly samples = new Map<string, MutableHotPathDiagnosticSample>();
	private windowStartedAt: number | null = null;

	constructor(options: HotPathDiagnosticsOptions = {}) {
		this.intervalMs = options.intervalMs !== undefined ? options.intervalMs : 1000;
		this.now = options.now !== undefined ? options.now : defaultNow;
		this.emit = options.emit !== undefined ? options.emit : emitHotPathDiagnosticsToConsole;
		this.isEnabled = options.isEnabled !== undefined ? options.isEnabled : () => false;
	}

	record(scope: string, event: string, value?: number): void {
		if (!this.isEnabled()) {
			return;
		}

		const currentNow = this.now();
		if (this.windowStartedAt === null) {
			this.windowStartedAt = currentNow;
		}

		if (currentNow - this.windowStartedAt >= this.intervalMs) {
			this.flushAt(currentNow);
		}

		const key = `${scope}:${event}`;
		const existing = this.samples.get(key);
		const numericValue = typeof value === "number" ? value : null;

		if (existing) {
			existing.count += 1;
			if (numericValue !== null) {
				existing.totalValue += numericValue;
				existing.maxValue = Math.max(existing.maxValue, numericValue);
				existing.lastValue = numericValue;
			}
			return;
		}

		this.samples.set(key, {
			scope,
			event,
			count: 1,
			totalValue: numericValue !== null ? numericValue : 0,
			maxValue: numericValue !== null ? numericValue : 0,
			lastValue: numericValue,
		});
	}

	flush(): void {
		if (!this.isEnabled()) {
			return;
		}
		this.flushAt(this.now());
	}

	reset(): void {
		this.samples.clear();
		this.windowStartedAt = null;
	}

	private flushAt(currentNow: number): void {
		if (this.windowStartedAt === null) {
			this.windowStartedAt = currentNow;
			return;
		}

		if (this.samples.size === 0) {
			this.windowStartedAt = currentNow;
			return;
		}

		const windowMs = Math.max(0, Math.round(currentNow - this.windowStartedAt));
		const snapshotSamples = Array.from(this.samples.values()).map((sample) => ({
			scope: sample.scope,
			event: sample.event,
			count: sample.count,
			totalValue: sample.totalValue,
			maxValue: sample.maxValue,
			lastValue: sample.lastValue,
		}));

		snapshotSamples.sort((left, right) => {
			const scopeCompare = left.scope.localeCompare(right.scope);
			if (scopeCompare !== 0) {
				return scopeCompare;
			}
			return left.event.localeCompare(right.event);
		});

		this.emit({
			windowMs,
			samples: snapshotSamples,
		});

		this.samples.clear();
		this.windowStartedAt = currentNow;
	}
}

declare global {
	interface Window {
		__ACEPE_ENABLE_HOT_PATH_DIAGNOSTICS__?: () => void;
		__ACEPE_DISABLE_HOT_PATH_DIAGNOSTICS__?: () => void;
		__ACEPE_DUMP_HOT_PATH_DIAGNOSTICS__?: () => void;
	}
}

function hasWindow(): boolean {
	return typeof window !== "undefined";
}

function getBrowserStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> | null {
	if (!hasWindow()) {
		return null;
	}

	const storage = window.localStorage;
	if (typeof storage !== "object" || storage === null) {
		return null;
	}

	if (
		typeof storage.getItem !== "function" ||
		typeof storage.setItem !== "function" ||
		typeof storage.removeItem !== "function"
	) {
		return null;
	}

	return storage;
}

function readBrowserHotPathDiagnosticsEnabled(): boolean {
	const storage = getBrowserStorage();
	if (!storage) {
		return false;
	}
	return storage.getItem(HOT_PATH_DIAGNOSTICS_STORAGE_KEY) === "1";
}

let browserHotPathDiagnosticsEnabled = readBrowserHotPathDiagnosticsEnabled();

const browserHotPathDiagnostics = new HotPathDiagnostics({
	intervalMs: 1000,
	emit: emitHotPathDiagnosticsToConsole,
	isEnabled: () => browserHotPathDiagnosticsEnabled,
});

function setBrowserHotPathDiagnosticsEnabled(enabled: boolean): void {
	browserHotPathDiagnosticsEnabled = enabled;
	const storage = getBrowserStorage();
	if (!storage) {
		return;
	}
	if (enabled) {
		storage.setItem(HOT_PATH_DIAGNOSTICS_STORAGE_KEY, "1");
		return;
	}
	storage.removeItem(HOT_PATH_DIAGNOSTICS_STORAGE_KEY);
	browserHotPathDiagnostics.reset();
}

function installBrowserHotPathDiagnosticsControls(): void {
	if (!hasWindow()) {
		return;
	}

	browserHotPathDiagnosticsEnabled = readBrowserHotPathDiagnosticsEnabled();
	window.__ACEPE_ENABLE_HOT_PATH_DIAGNOSTICS__ = () => {
		setBrowserHotPathDiagnosticsEnabled(true);
	};
	window.__ACEPE_DISABLE_HOT_PATH_DIAGNOSTICS__ = () => {
		setBrowserHotPathDiagnosticsEnabled(false);
	};
	window.__ACEPE_DUMP_HOT_PATH_DIAGNOSTICS__ = () => {
		browserHotPathDiagnostics.flush();
	};
}

installBrowserHotPathDiagnosticsControls();

export function recordHotPathDiagnostic(scope: string, event: string, value?: number): void {
	browserHotPathDiagnostics.record(scope, event, value);
}

export function flushHotPathDiagnostics(): void {
	browserHotPathDiagnostics.flush();
}
