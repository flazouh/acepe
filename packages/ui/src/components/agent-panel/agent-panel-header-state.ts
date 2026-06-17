import type {
	AgentPanelActionDescriptor,
	AgentPanelBadge,
	AgentSessionStatus,
} from "./types.js";

export type HeaderStatusIndicatorKind =
	| "custom"
	| "connecting"
	| "connected"
	| "error"
	| "none";

export function getAgentPanelHeaderTitle(input: {
	displayTitle?: string;
	sessionTitle?: string;
}): string {
	return input.displayTitle
		? input.displayTitle
		: input.sessionTitle
			? input.sessionTitle
			: "New thread";
}

export function getVisibleHeaderActionButtons(
	actionButtons?: readonly AgentPanelActionDescriptor[]
): readonly AgentPanelActionDescriptor[] {
	return (actionButtons ?? []).filter((action) => action.state !== "hidden");
}

export function isHeaderActionDisabled(
	action: AgentPanelActionDescriptor
): boolean {
	return action.state === "disabled" || action.state === "busy";
}

export function hasAgentPanelHeaderMetaChips(input: {
	subtitle?: string;
	agentLabel?: string | null;
	branchLabel?: string | null;
	badges?: readonly AgentPanelBadge[];
}): boolean {
	return (
		Boolean(input.subtitle) ||
		Boolean(input.agentLabel) ||
		Boolean(input.branchLabel) ||
		(input.badges?.length ?? 0) > 0
	);
}

export function shouldShowAgentPanelHeaderTitleTooltip(input: {
	pendingProjectSelection: boolean;
}): boolean {
	return !input.pendingProjectSelection;
}

export function hasAgentPanelHeaderTooltipDetails(input: {
	hasExpansionSlot: boolean;
	hasMetaChips: boolean;
}): boolean {
	return input.hasExpansionSlot || input.hasMetaChips;
}

export function getHeaderStatusIndicatorKind(input: {
	hasCustomStatusIndicator: boolean;
	isConnecting: boolean;
	sessionStatus: AgentSessionStatus;
}): HeaderStatusIndicatorKind {
	if (input.hasCustomStatusIndicator) return "custom";
	if (input.isConnecting || input.sessionStatus === "warming") return "connecting";
	if (input.sessionStatus === "connected") return "connected";
	if (input.sessionStatus === "error") return "error";
	return "none";
}
