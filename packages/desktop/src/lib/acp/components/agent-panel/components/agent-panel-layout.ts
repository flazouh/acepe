interface AgentPanelWidthStyleInput {
	effectiveWidth: number;
	isFullscreen: boolean;
}

interface AgentPanelEffectiveWidthInput {
	baseWidth: number;
	reviewMode: boolean;
	showPlanSidebar: boolean;
	hasPlan: boolean;
	planSidebarColumnWidth: number;
	showBrowserSidebar: boolean;
	browserSidebarColumnWidth: number;
}

interface AttachedPaneLayoutInput {
	hasAttachedPane: boolean;
	isFullscreen: boolean;
	attachedColumnWidth: number;
}

interface CenteredFullscreenContentInput {
	hasAttachedPane: boolean;
	isFullscreen: boolean;
}

export function resolveAgentPanelEffectiveWidth(input: AgentPanelEffectiveWidthInput): number {
	let width = input.reviewMode ? input.baseWidth * 2 : input.baseWidth;

	if (input.showPlanSidebar && input.hasPlan) {
		width += input.planSidebarColumnWidth;
	}

	if (input.showBrowserSidebar) {
		width += input.browserSidebarColumnWidth;
	}

	return width;
}

export function resolveAgentPanelWidthStyle(input: AgentPanelWidthStyleInput): string {
	if (input.isFullscreen) {
		return "width: 100%; min-width: 0; max-width: 100%;";
	}

	return `min-width: ${input.effectiveWidth}px; width: ${input.effectiveWidth}px; max-width: ${input.effectiveWidth}px;`;
}

export function resolveAgentContentColumnStyle(input: AttachedPaneLayoutInput): string {
	if (!input.hasAttachedPane || input.isFullscreen) {
		return "";
	}

	return `min-width: ${input.attachedColumnWidth}px; width: ${input.attachedColumnWidth}px; max-width: ${input.attachedColumnWidth}px; flex: 0 0 ${input.attachedColumnWidth}px;`;
}

export function shouldUseCenteredFullscreenContent(input: CenteredFullscreenContentInput): boolean {
	if (!input.isFullscreen) {
		return false;
	}

	return !input.hasAttachedPane;
}
