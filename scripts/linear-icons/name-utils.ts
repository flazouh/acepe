const ICON_SUFFIX_PATTERN = /Icon$/;

export function assetBaseName(assetName: string): string {
	const finalSegment = assetName.split("/").pop();
	const fileName = finalSegment ? finalSegment : assetName;
	const dotIndex = fileName.indexOf(".");
	if (dotIndex === -1) {
		return fileName;
	}
	return fileName.slice(0, dotIndex);
}

export function pascalCaseToKebabCase(value: string): string {
	return value
		.replace(/([a-z0-9])([A-Z])/g, "$1-$2")
		.replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
		.toLowerCase();
}

export function cleanIconName(originalName: string): string {
	const withoutIconSuffix = originalName.replace(ICON_SUFFIX_PATTERN, "");
	return pascalCaseToKebabCase(withoutIconSuffix);
}

export function isDedicatedIconChunk(assetName: string): boolean {
	return /Icon(?:Large)?\.[A-Za-z0-9_-]+\.js$/.test(assetName);
}
