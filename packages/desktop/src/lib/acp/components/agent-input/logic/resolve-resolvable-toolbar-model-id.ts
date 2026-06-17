export function resolveResolvableToolbarModelId(input: {
	readonly provisionalModelId: string | null;
	readonly resolvedToolbarModelId: string | null;
}): string | null {
	if (input.provisionalModelId) {
		return input.provisionalModelId;
	}

	return input.resolvedToolbarModelId;
}
