export type DeferredWorkHandle = {
	cancel: () => void;
};

const LAZY_PANEL_WORK_DELAY_MS = 16;
const LAZY_PANEL_METADATA_DELAY_MS = 250;

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

export function scheduleLazyPanelWork(work: () => void): DeferredWorkHandle {
	return scheduleDeferredPanelWork(work, LAZY_PANEL_WORK_DELAY_MS);
}

export function scheduleLazyPanelMetadataWork(work: () => void): DeferredWorkHandle {
	return scheduleDeferredPanelWork(work, LAZY_PANEL_METADATA_DELAY_MS);
}
