const DEFAULT_DEFERRED_WORK_DELAY_MS = 2_000;
const DEFAULT_DEFERRED_WORK_TIMEOUT_MS = 5_000;

type DeferredWorkOptions = {
	readonly delayMs?: number;
	readonly timeoutMs?: number;
};

type WindowWithIdleCallback = Window & {
	requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
};

export function scheduleDeferredIdleWork(
	callback: () => void,
	options: DeferredWorkOptions = {}
): void {
	const delayMs = options.delayMs ?? DEFAULT_DEFERRED_WORK_DELAY_MS;
	const timeoutMs = options.timeoutMs ?? DEFAULT_DEFERRED_WORK_TIMEOUT_MS;

	if (typeof window === "undefined") {
		setTimeout(callback, delayMs);
		return;
	}

	window.setTimeout(() => {
		const schedulingWindow = window as WindowWithIdleCallback;
		if (typeof schedulingWindow.requestIdleCallback === "function") {
			schedulingWindow.requestIdleCallback(callback, { timeout: timeoutMs });
			return;
		}
		window.setTimeout(callback, 0);
	}, delayMs);
}
