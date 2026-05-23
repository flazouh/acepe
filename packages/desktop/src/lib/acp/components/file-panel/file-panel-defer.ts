export type DeferredWorkHandle = {
	cancel: () => void;
};

const LAZY_PANEL_WORK_DELAY_MS = 16;

export function scheduleLazyPanelWork(work: () => void): DeferredWorkHandle {
	let timeoutId: ReturnType<typeof setTimeout> | null = setTimeout(() => {
		timeoutId = null;
		work();
	}, LAZY_PANEL_WORK_DELAY_MS);

	return {
		cancel() {
			if (timeoutId !== null) {
				clearTimeout(timeoutId);
				timeoutId = null;
			}
		},
	};
}
