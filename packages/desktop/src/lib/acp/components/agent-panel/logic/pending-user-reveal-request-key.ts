export function derivePendingUserRevealRequestKey(input: {
	readonly panelId: string;
	readonly userRevealRequestVersion: number;
}): string | null {
	if (input.userRevealRequestVersion === 0) {
		return null;
	}
	return `${input.panelId}:${input.userRevealRequestVersion}`;
}
