import {
	type ProjectId,
	type RpcProjectedProject,
	type RpcProjectedSession,
	type RpcSessionSnapshot,
} from "@acepe/contracts";
import type {
	LibrarySessionLifecycle,
	LibrarySidebarProject,
	LibrarySidebarSession,
	LibrarySidebarViewModel,
} from "@acepe/ui/library-sidebar";
import * as Arr from "effect/Array";

export const LIBRARY_SIDEBAR_COPY = {
	projectsHeading: "Projects",
	sessionsHeading: "Sessions",
	emptyProjectsLabel: "No projects",
	emptySessionsLabel: "Select a project",
	archivedLabel: "Archived",
	deletedLabel: "Deleted",
} as const;

export const sessionLifecycle = (session: RpcProjectedSession): LibrarySessionLifecycle => {
	if (session.deletedAt !== null) {
		return "deleted";
	}
	if (session.archivedAt !== null) {
		return "archived";
	}
	return "active";
};

export const sessionLifecycleLabel = (
	lifecycle: LibrarySessionLifecycle,
): string | null => {
	if (lifecycle === "archived") {
		return LIBRARY_SIDEBAR_COPY.archivedLabel;
	}
	if (lifecycle === "deleted") {
		return LIBRARY_SIDEBAR_COPY.deletedLabel;
	}
	return null;
};

export const projectFromProjection = (project: RpcProjectedProject): LibrarySidebarProject => {
	const deleted = project.deletedAt !== null;
	return {
		id: project.projectId,
		title: project.title,
		deleted,
		deletedLabel: deleted ? LIBRARY_SIDEBAR_COPY.deletedLabel : null,
	};
};

export const sessionFromProjection = (session: RpcProjectedSession): LibrarySidebarSession => {
	const lifecycle = sessionLifecycle(session);
	return {
		id: session.sessionId,
		title: session.title,
		lifecycle,
		lifecycleLabel: sessionLifecycleLabel(lifecycle),
	};
};

export const librarySidebarViewModel = (input: {
	readonly snapshot: RpcSessionSnapshot;
	readonly selectedProjectId: ProjectId | null;
}): LibrarySidebarViewModel => {
	const selectedProjectId = input.selectedProjectId;
	const matching =
		selectedProjectId === null
			? Arr.empty<RpcProjectedSession>()
			: Arr.filter(
					input.snapshot.sessions,
					(session) => session.projectId === selectedProjectId,
				);
	return {
		projectsHeading: LIBRARY_SIDEBAR_COPY.projectsHeading,
		sessionsHeading: LIBRARY_SIDEBAR_COPY.sessionsHeading,
		emptyProjectsLabel: LIBRARY_SIDEBAR_COPY.emptyProjectsLabel,
		emptySessionsLabel: LIBRARY_SIDEBAR_COPY.emptySessionsLabel,
		selectedProjectId,
		projects: Arr.map(input.snapshot.projects, projectFromProjection),
		sessions: Arr.map(matching, sessionFromProjection),
	};
};
