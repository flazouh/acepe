export type RevealTargetActionParams = {
	entryIndex: number;
	entryKey: string;
	observeRevealResize: boolean;
	onRevealResize?: () => void;
};

export function shouldRestartRevealTargetAction(
	currentParams: RevealTargetActionParams,
	nextParams: RevealTargetActionParams
): boolean {
	return (
		nextParams.entryKey !== currentParams.entryKey ||
		nextParams.observeRevealResize !== currentParams.observeRevealResize ||
		(nextParams.onRevealResize !== undefined) !== (currentParams.onRevealResize !== undefined)
	);
}
