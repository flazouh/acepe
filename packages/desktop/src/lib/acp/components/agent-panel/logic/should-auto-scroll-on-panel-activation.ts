type ShouldAutoScrollOnPanelActivationOptions = {
	currentPanelId: string | undefined;
	previousPanelId: string | undefined;
};

export function shouldAutoScrollOnPanelActivation(
	options: ShouldAutoScrollOnPanelActivationOptions
): boolean {
	if (!options.currentPanelId || !options.previousPanelId) {
		return false;
	}

	return options.currentPanelId !== options.previousPanelId;
}
