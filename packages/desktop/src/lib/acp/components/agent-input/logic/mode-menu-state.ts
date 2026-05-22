export type ModeMenuOptionId = string;

interface ResolveSelectedModeMenuOptionIdInput {
	readonly currentModeId: string | null;
	readonly autonomousEnabled: boolean;
}

interface ResolveModeMenuActionInput {
	readonly selectedOptionId: ModeMenuOptionId;
	readonly currentModeId: string | null;
	readonly autonomousEnabled: boolean;
}

interface ModeMenuActionResolution {
	readonly modeIdToApply: string | null;
	readonly autonomousEnabledToApply: boolean | null;
}

export function resolveSelectedModeMenuOptionId(
	input: ResolveSelectedModeMenuOptionIdInput
): ModeMenuOptionId | null {
	return input.currentModeId;
}

export function resolveModeMenuAction(input: ResolveModeMenuActionInput): ModeMenuActionResolution {
	return {
		modeIdToApply: input.currentModeId === input.selectedOptionId ? null : input.selectedOptionId,
		autonomousEnabledToApply: input.autonomousEnabled ? false : null,
	};
}
