export type LibrarySessionLifecycle = "active" | "archived" | "deleted"

export type LibrarySidebarSession = {
	readonly id: string
	readonly title: string
	readonly lifecycle: LibrarySessionLifecycle
	readonly lifecycleLabel: string | null
}

export type LibrarySidebarProject = {
	readonly id: string
	readonly title: string
	readonly deleted: boolean
	readonly deletedLabel: string | null
}

export type LibrarySidebarViewModel = {
	readonly projectsHeading: string
	readonly sessionsHeading: string
	readonly emptyProjectsLabel: string
	readonly emptySessionsLabel: string
	readonly selectedProjectId: string | null
	readonly projects: ReadonlyArray<LibrarySidebarProject>
	readonly sessions: ReadonlyArray<LibrarySidebarSession>
}

export const isSelectedProject = (input: {
	readonly projectId: string
	readonly selectedProjectId: string | null
}): boolean => input.selectedProjectId === input.projectId
