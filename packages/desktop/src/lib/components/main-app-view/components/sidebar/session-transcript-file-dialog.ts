export type SessionTranscriptFileDialogTarget = {
	projectPath: string;
	filePath: string;
	projectName: string;
};

function getPathLabel(path: string): string {
	const segments = path.split("/").filter((segment) => segment.length > 0);
	const lastSegment = segments[segments.length - 1];
	return lastSegment ?? path;
}

export function buildSessionTranscriptFileDialogTarget(
	fullPath: string
): SessionTranscriptFileDialogTarget | null {
	const trimmedPath = fullPath.trim();
	if (trimmedPath.length === 0) {
		return null;
	}

	const normalizedPath = trimmedPath.replaceAll("\\", "/");
	const separatorIndex = normalizedPath.lastIndexOf("/");
	if (separatorIndex < 0) {
		return null;
	}

	const filePath = normalizedPath.slice(separatorIndex + 1);
	if (filePath.length === 0) {
		return null;
	}

	const projectPath = normalizedPath.slice(0, separatorIndex) || "/";
	return {
		projectPath,
		filePath,
		projectName: getPathLabel(projectPath),
	};
}
