import type { ProjectWithSessions } from "./open-project-dialog-props.js";

export function filterProjectsBySearchQuery(
	projects: ProjectWithSessions[],
	searchQuery: string
): ProjectWithSessions[] {
	const query = searchQuery.trim().toLowerCase();
	if (!query) return projects;

	return projects.filter((project) => {
		return project.name.toLowerCase().includes(query) || project.path.toLowerCase().includes(query);
	});
}

export function isCloneFormValid(cloneUrl: string, cloneDestination: string): boolean {
	return cloneUrl.trim().length > 0 && cloneDestination.trim().length > 0;
}

export function extractProjectDisplayNameFromPath(path: string): string {
	const parts = path.split("/");
	const name = parts[parts.length - 1] ?? "Unknown";

	return name
		.split(/[-_]/)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
		.join(" ");
}

interface ImportFooterLabelInput {
	readonly searchQuery: string;
	readonly filteredProjectCount: number;
	readonly projectCount: number;
}

export function getImportFooterProjectLabel(input: ImportFooterLabelInput): string {
	if (input.searchQuery.trim()) {
		return `${input.filteredProjectCount} of ${input.projectCount} projects`;
	}

	return `${input.projectCount} projects found`;
}
