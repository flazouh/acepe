export type DeferredWorkHandle = {
	cancel: () => void;
};

const LAZY_PANEL_WORK_DELAY_MS = 16;
const LAZY_PANEL_METADATA_DELAY_MS = 250;
const LAZY_PANEL_METADATA_IDLE_TIMEOUT_MS = 2_000;

type IdleCallbackHandle = number;
type IdleCallbackOptions = {
	timeout?: number;
};
type IdleCallback = (deadline: IdleDeadline) => void;
type IdleDeadline = {
	readonly didTimeout: boolean;
	timeRemaining(): number;
};

function getRequestIdleCallback():
	| ((callback: IdleCallback, options?: IdleCallbackOptions) => IdleCallbackHandle)
	| undefined {
	return typeof globalThis.requestIdleCallback === "function"
		? globalThis.requestIdleCallback.bind(globalThis)
		: undefined;
}

function getCancelIdleCallback(): ((handle: IdleCallbackHandle) => void) | undefined {
	return typeof globalThis.cancelIdleCallback === "function"
		? globalThis.cancelIdleCallback.bind(globalThis)
		: undefined;
}

function scheduleDeferredPanelWork(work: () => void, delayMs: number): DeferredWorkHandle {
	let timeoutId: ReturnType<typeof setTimeout> | null = setTimeout(() => {
		timeoutId = null;
		work();
	}, delayMs);

	return {
		cancel() {
			if (timeoutId !== null) {
				clearTimeout(timeoutId);
				timeoutId = null;
			}
		},
	};
}

function scheduleIdlePanelWork(work: () => void): DeferredWorkHandle {
	const requestIdleCallback = getRequestIdleCallback();
	if (requestIdleCallback === undefined) {
		return scheduleDeferredPanelWork(work, LAZY_PANEL_METADATA_DELAY_MS);
	}

	let timeoutId: ReturnType<typeof setTimeout> | null = null;
	let idleCallbackId: IdleCallbackHandle | null = requestIdleCallback(
		() => {
			runWork({ cancelIdleCallback: false });
		},
		{ timeout: LAZY_PANEL_METADATA_IDLE_TIMEOUT_MS }
	);
	timeoutId = setTimeout(() => {
		runWork({ cancelIdleCallback: true });
	}, LAZY_PANEL_METADATA_IDLE_TIMEOUT_MS);

	function runWork(options: { cancelIdleCallback: boolean }): void {
		if (idleCallbackId === null) {
			return;
		}
		const completedIdleCallbackId = idleCallbackId;
		idleCallbackId = null;
		if (timeoutId !== null) {
			clearTimeout(timeoutId);
			timeoutId = null;
		}
		const cancelIdleCallback = getCancelIdleCallback();
		if (options.cancelIdleCallback && cancelIdleCallback !== undefined) {
			cancelIdleCallback(completedIdleCallbackId);
		}
		work();
	}

	return {
		cancel() {
			if (idleCallbackId === null) {
				return;
			}
			if (timeoutId !== null) {
				clearTimeout(timeoutId);
				timeoutId = null;
			}
			const cancelIdleCallback = getCancelIdleCallback();
			cancelIdleCallback?.(idleCallbackId);
			idleCallbackId = null;
		},
	};
}

export function scheduleLazyPanelWork(work: () => void): DeferredWorkHandle {
	return scheduleDeferredPanelWork(work, LAZY_PANEL_WORK_DELAY_MS);
}

export function scheduleLazyPanelMetadataWork(work: () => void): DeferredWorkHandle {
	return scheduleIdlePanelWork(work);
}
