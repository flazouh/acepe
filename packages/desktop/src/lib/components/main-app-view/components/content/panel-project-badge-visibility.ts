export interface ProjectBadgeVisibilityInput {
	readonly groupCount: number;
	readonly isMultiCardsMode: boolean;
}

export function shouldHideAgentPanelProjectBadge(_input: ProjectBadgeVisibilityInput): boolean {
	return false;
}
