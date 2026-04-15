export const MODE_MENU_OPTION_ID = {
	AUTO: "auto",
} as const;

export type ModeMenuOptionId = string;

interface ResolveSelectedModeMenuOptionIdInput {
	readonly currentModeId: string | null;
	readonly autonomousEnabled: boolean;
}

interface ResolveModeMenuActionInput {
	readonly selectedOptionId: ModeMenuOptionId;
	readonly currentModeId: string | null;
	readonly autonomousEnabled: boolean;
	readonly buildModeId: string;
}

interface ModeMenuActionResolution {
	readonly modeIdToApply: string | null;
	readonly autonomousEnabledToApply: boolean | null;
}

export function resolveSelectedModeMenuOptionId(
	input: ResolveSelectedModeMenuOptionIdInput
): ModeMenuOptionId | null {
	if (input.autonomousEnabled) {
		return MODE_MENU_OPTION_ID.AUTO;
	}

	return input.currentModeId;
}

export function resolveModeMenuAction(
	input: ResolveModeMenuActionInput
): ModeMenuActionResolution {
	if (input.selectedOptionId === MODE_MENU_OPTION_ID.AUTO) {
		return {
			modeIdToApply: input.currentModeId === input.buildModeId ? null : input.buildModeId,
			autonomousEnabledToApply: input.autonomousEnabled ? null : true,
		};
	}

	return {
		modeIdToApply: input.currentModeId === input.selectedOptionId ? null : input.selectedOptionId,
		autonomousEnabledToApply: input.autonomousEnabled ? false : null,
	};
}
