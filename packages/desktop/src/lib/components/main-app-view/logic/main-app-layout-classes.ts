const WORKSPACE_FRAME_BASE_CLASS = "flex-1 flex min-h-0 gap-0.5 overflow-hidden";

const WORKSPACE_SIDEBAR_BASE_CLASS =
	"shrink-0 flex flex-col h-full min-h-0 overflow-hidden";

export function resolveWorkspaceFrameClass(): string {
	return WORKSPACE_FRAME_BASE_CLASS;
}

export function resolveWorkspaceSidebarClass(sidebarOpen: boolean): string {
	if (sidebarOpen) {
		return `${WORKSPACE_SIDEBAR_BASE_CLASS} opacity-100`;
	}

	return `${WORKSPACE_SIDEBAR_BASE_CLASS} w-0 opacity-0 pointer-events-none`;
}
