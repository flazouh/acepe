import type { SidebarUpdateKind } from "./types.js";

/** Single minimal variant kept as a named design token for API compatibility. */
export type SidebarUpdateCardVariant = "minimal";

export type SidebarUpdateCardSurfaceTokens = "minimal";

export interface SidebarUpdateCardVariantDefinition {
	readonly id: SidebarUpdateCardVariant;
	readonly label: string;
	readonly description: string;
	readonly shellClass: string;
	readonly ctaClass: string;
	readonly iconClass: string;
	readonly surfaceTokens: SidebarUpdateCardSurfaceTokens;
}

const MINIMAL_SIDEBAR_UPDATE_CARD_VARIANT: SidebarUpdateCardVariantDefinition = {
	id: "minimal",
	label: "Minimal",
	description: "Quiet sidebar notice using the normal app theme colors.",
	shellClass: "shadow-none",
	ctaClass:
		"shrink-0 h-6 rounded-md border border-[color:var(--update-card-action-border)] bg-transparent px-2 text-[10px] font-medium text-[color:var(--update-card-action-text)] hover:bg-[color:var(--update-card-action-bg)] hover:text-[color:var(--update-card-action-text)]",
	iconClass: "text-[color:var(--update-card-icon-text)]",
	surfaceTokens: "minimal",
};

export const SIDEBAR_UPDATE_CARD_VARIANTS: readonly SidebarUpdateCardVariantDefinition[] = [
	MINIMAL_SIDEBAR_UPDATE_CARD_VARIANT,
];

export const DEFAULT_SIDEBAR_UPDATE_CARD_VARIANT: SidebarUpdateCardVariant = "minimal";

const variantById: Readonly<Record<SidebarUpdateCardVariant, SidebarUpdateCardVariantDefinition>> =
	{
		minimal: MINIMAL_SIDEBAR_UPDATE_CARD_VARIANT,
	};

export function isSidebarUpdateCardVariant(
	variant: string,
): variant is SidebarUpdateCardVariant {
	return Object.prototype.hasOwnProperty.call(variantById, variant);
}

export function getSidebarUpdateCardVariantDefinition(
	variant: SidebarUpdateCardVariant | string,
): SidebarUpdateCardVariantDefinition {
	if (!isSidebarUpdateCardVariant(variant)) {
		return variantById[DEFAULT_SIDEBAR_UPDATE_CARD_VARIANT];
	}

	return variantById[variant];
}

export interface SidebarUpdateCardCopy {
	readonly title: string;
	readonly ctaLabel: string;
	readonly progressLabel: string;
}

export function getSidebarUpdateCardCopy(input: {
	kind: SidebarUpdateKind;
	version: string | null;
	percent: number;
}): SidebarUpdateCardCopy {
	const roundedPercent = Math.round(Math.min(Math.max(input.percent, 0), 100));

	if (input.kind === "downloading") {
		return {
			title: `Downloading ${roundedPercent}%`,
			ctaLabel: "Install",
			progressLabel: "Downloading update",
		};
	}

	if (input.kind === "installing") {
		return {
			title: "Installing update",
			ctaLabel: "Install",
			progressLabel: "Installing update",
		};
	}

	if (input.kind === "error") {
		return {
			title: "Update failed",
			ctaLabel: "Retry",
			progressLabel: "Update failed",
		};
	}

	return {
		title: input.version ? `Version ${input.version}, ready` : "Version ready",
		ctaLabel: "Install",
		progressLabel: "Update available",
	};
}
