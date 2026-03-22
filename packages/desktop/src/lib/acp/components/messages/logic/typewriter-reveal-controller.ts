import { createTextReveal, type TextRevealController } from "./text-reveal.js";

export interface TypewriterRevealBinding {
	bindContainer(container: HTMLElement | null): void;
	setStreaming(isStreaming: boolean): void;
	destroy(): void;
}

type RevealFactory = (container: HTMLElement) => TextRevealController;

export function createTypewriterRevealBinding(
	createReveal: RevealFactory = createTextReveal
): TypewriterRevealBinding {
	let currentContainer: HTMLElement | null = null;
	let currentReveal: TextRevealController | null = null;
	let isStreaming = false;

	function destroyCurrentReveal() {
		if (!currentReveal) {
			return;
		}

		currentReveal.destroy();
		currentReveal = null;
	}

	return {
		bindContainer(container: HTMLElement | null) {
			if (container === currentContainer) {
				return;
			}

			destroyCurrentReveal();
			currentContainer = container;

			if (!container) {
				return;
			}

			currentReveal = createReveal(container);
			currentReveal.setStreaming(isStreaming);
		},
		setStreaming(nextIsStreaming: boolean) {
			isStreaming = nextIsStreaming;
			currentReveal?.setStreaming(nextIsStreaming);
		},
		destroy() {
			destroyCurrentReveal();
			currentContainer = null;
		},
	};
}
