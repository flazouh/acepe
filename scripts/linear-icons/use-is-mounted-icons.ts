/**
 * Semantic names for minified icon component functions in Linear's shared
 * useIsMounted bundle. Unmapped functions become SharedJsx{Fn}Icon entries.
 */
export const USE_IS_MOUNTED_BUNDLE_PATTERN =
	/^useIsMounted\.[A-Za-z0-9_-]+\.js$/;

export const REGISTER_ACTION_BUNDLE_PATTERN =
	/^RegisterAction\.[A-Za-z0-9_-]+\.js$/;

export const EDITOR_ACTIONS_BUNDLE_PATTERN =
	/^EditorActions\.[A-Za-z0-9_-]+\.js$/;

export const USE_IS_MOUNTED_ICON_NAMES: Readonly<Record<string, string>> = {
	bm: "CopyIcon",
	YT: "CopyOutlineIcon",
	bX: "CopyStackedIcon",
	Fm: "HorizontalEllipsisIcon",
	XY: "ChevronUpIcon",
	EJ: "PlayIcon",
	UT: "ArchiveIcon",
	RH: "SidebarPanelIcon",
	WH: "SplitColumnsIcon",
	_m: "TrashRemoveIcon",
	nU: "SlashCancelIcon",
	mJ: "CheckIcon",
	i0: "SkillsIcon",
};

const REGISTER_ACTION_ICON_NAMES: Readonly<Record<string, string>> = {
	wt: "DisplayOptionsIcon",
};

const EDITOR_ACTIONS_ICON_NAMES: Readonly<Record<string, string>> = {
	Xa: "EditIcon",
};

export const SHARED_BUNDLE_ICON_FN_PATTERN =
	/function ([A-Za-z_$][\w$]*)\(e\)\{return/g;

export const MAX_SHARED_BUNDLE_ICON_DIMENSION = 24;

export const MAX_SHARED_BUNDLE_ICON_SCAN_DISTANCE = 600;

export function sharedBundleIconOriginalName(fnName: string): string {
	const semanticName = USE_IS_MOUNTED_ICON_NAMES[fnName];
	return semanticName ? semanticName : `SharedJsx${fnName}Icon`;
}

export function knownBundleIconOriginalName(
	assetName: string,
	fnName: string,
): string | null {
	if (USE_IS_MOUNTED_BUNDLE_PATTERN.test(assetName)) {
		return sharedBundleIconOriginalName(fnName);
	}

	if (REGISTER_ACTION_BUNDLE_PATTERN.test(assetName)) {
		const iconName = REGISTER_ACTION_ICON_NAMES[fnName];
		return iconName === undefined ? null : iconName;
	}

	if (EDITOR_ACTIONS_BUNDLE_PATTERN.test(assetName)) {
		const iconName = EDITOR_ACTIONS_ICON_NAMES[fnName];
		return iconName === undefined ? null : iconName;
	}

	return null;
}

export function isCompactIconViewBox(viewBox: string): boolean {
	const parts = viewBox.trim().split(/\s+/).map(Number);
	if (parts.length !== 4) {
		return true;
	}

	const width = parts[2] === undefined ? 16 : parts[2];
	const height = parts[3] === undefined ? 16 : parts[3];
	if (!Number.isFinite(width) || !Number.isFinite(height)) {
		return true;
	}

	return (
		width <= MAX_SHARED_BUNDLE_ICON_DIMENSION &&
		height <= MAX_SHARED_BUNDLE_ICON_DIMENSION
	);
}
