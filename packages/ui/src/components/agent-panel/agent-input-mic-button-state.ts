export function getMicButtonAccessibleDescription(
	label: string,
	shortcut: readonly string[]
): string {
	if (shortcut.length > 0) {
		return `${label} ${shortcut.join(" ")}`;
	}
	return label;
}
