export interface MainAppDestroyPolicyInput {
	readonly hmrTeardownActive: boolean;
}

export function shouldDisconnectSessionsOnMainAppDestroy(
	input: MainAppDestroyPolicyInput
): boolean {
	return input.hmrTeardownActive === false;
}
