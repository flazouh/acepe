interface ProjectGroupDeckLayoutInput {
	readonly activeProjectPath: string | null;
	readonly groupProjectPath: string;
	readonly hasAgentPanels: boolean;
	readonly isAgentFullscreenGroup: boolean;
}

interface ProjectGroupDeckLayout {
	readonly className: string;
	readonly isInactive: boolean;
	readonly inert: boolean;
	readonly ariaHidden: "true" | undefined;
}

const PROJECT_GROUP_BASE_CLASS = "flex flex-row items-stretch gap-0.5";

function resolveProjectGroupSizeClass(input: ProjectGroupDeckLayoutInput): string {
	if (input.activeProjectPath !== null) {
		return "flex-1 min-w-0 min-h-0";
	}

	if (input.isAgentFullscreenGroup || !input.hasAgentPanels) {
		return "flex-1 min-w-0 min-h-0";
	}

	return "flex-none min-h-0";
}

export function resolveProjectDeckContainerClass(activeProjectPath: string | null): string {
	if (activeProjectPath === null) {
		return "contents";
	}

	return "relative flex flex-1 min-w-0 min-h-0 overflow-hidden";
}

export function resolveProjectGroupDeckLayout(
	input: ProjectGroupDeckLayoutInput
): ProjectGroupDeckLayout {
	const usesDeck = input.activeProjectPath !== null;
	const isInactive = usesDeck && input.groupProjectPath !== input.activeProjectPath;
	const sizeClass = resolveProjectGroupSizeClass(input);
	const deckClass = usesDeck
		? isInactive
			? "absolute inset-0 invisible pointer-events-none"
			: "relative visible pointer-events-auto"
		: "";
	const className =
		deckClass.length > 0
			? `${PROJECT_GROUP_BASE_CLASS} ${sizeClass} ${deckClass}`
			: `${PROJECT_GROUP_BASE_CLASS} ${sizeClass}`;

	return {
		className,
		isInactive,
		inert: isInactive,
		ariaHidden: isInactive ? "true" : undefined,
	};
}
