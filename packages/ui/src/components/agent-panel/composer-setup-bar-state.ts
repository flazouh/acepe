export type ComposerSetupBarSkill = {
	readonly id: string;
	readonly name: string;
};

export type ComposerSetupBarServer = {
	readonly id: string;
	readonly name: string;
	readonly status: string;
};

export const composerSetupBarIsEmpty = (input: {
	readonly skills: ReadonlyArray<ComposerSetupBarSkill>;
	readonly servers: ReadonlyArray<ComposerSetupBarServer>;
	readonly optionCount: number;
}): boolean =>
	input.skills.length === 0 && input.servers.length === 0 && input.optionCount === 0;
