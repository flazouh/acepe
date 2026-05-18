import { formatSessionTitleForDisplay } from "../../../store/session-title-policy.js";

export function deriveAgentPanelHeaderDisplayTitle(input: {
	readonly sessionTitle: string | null;
	readonly projectName: string | null;
}): string | null {
	const titleSource = input.sessionTitle;
	if (titleSource === null && input.projectName === null) {
		return null;
	}

	return formatSessionTitleForDisplay(titleSource, input.projectName, "Project");
}
