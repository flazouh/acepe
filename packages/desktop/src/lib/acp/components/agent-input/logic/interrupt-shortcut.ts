export interface InterruptShortcutEventLike {
	readonly key: string;
	readonly ctrlKey: boolean;
	readonly metaKey: boolean;
	readonly altKey: boolean;
	readonly shiftKey: boolean;
	readonly repeat?: boolean;
}

export function shouldInterruptComposerStream(_params: {
	readonly isMac: boolean;
	readonly isStreaming: boolean;
	readonly event: InterruptShortcutEventLike;
}): boolean {
	if (!_params.isMac || !_params.isStreaming) {
		return false;
	}

	if (_params.event.repeat === true) {
		return false;
	}

	if (_params.event.key.toLowerCase() !== "c") {
		return false;
	}

	if (
		!_params.event.ctrlKey ||
		_params.event.metaKey ||
		_params.event.altKey ||
		_params.event.shiftKey
	) {
		return false;
	}

	return true;
}
