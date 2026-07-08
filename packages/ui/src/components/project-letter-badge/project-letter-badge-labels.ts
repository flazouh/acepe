/**
 * A project's stable identity plus the name its badge label is derived from.
 */
export type ProjectBadgeLabelInput = {
	/** Stable identity for the project (its path). Keys the returned map. */
	key: string;
	/** Display name the badge label is derived from. */
	name: string;
};

/**
 * Capitalize the first character of a prefix, leaving the rest as authored.
 * Mirrors {@link ProjectLetterBadge}'s uppercase single-letter rendering while
 * keeping multi-letter prefixes readable (e.g. "Ac" rather than "AC").
 */
function formatLabel(name: string, length: number): string {
	const prefix = name.slice(0, length);
	if (prefix.length === 0) return "";
	return prefix.charAt(0).toUpperCase() + prefix.slice(1);
}

/**
 * Compute a badge label per project that is unique across the whole set.
 *
 * Starts from the first letter and grows the prefix one character at a time
 * until no other project shares it, so colliding first letters (e.g. "Acepe"
 * and "Apple") disambiguate to "Ac" / "Ap". Comparison is case-insensitive to
 * match the badge's uppercase rendering. When two projects share an entire
 * name the prefix cannot disambiguate them and both fall back to the full name.
 */
export function computeProjectBadgeLabels(
	projects: ProjectBadgeLabelInput[]
): Map<string, string> {
	const upper = projects.map((project) => ({
		key: project.key,
		name: project.name,
		normalized: project.name.toUpperCase(),
	}));

	const labels = new Map<string, string>();

	for (const project of upper) {
		let length = 1;
		while (length < project.normalized.length) {
			const prefix = project.normalized.slice(0, length);
			const collides = upper.some(
				(other) => other.key !== project.key && other.normalized.startsWith(prefix)
			);
			if (!collides) break;
			length++;
		}
		labels.set(project.key, formatLabel(project.name, length));
	}

	return labels;
}
