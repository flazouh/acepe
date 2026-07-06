import {
	BRAND_SHADER_ACEPE_PANEL_PALETTE,
	BRAND_SHADER_LUMINAR_PANEL_PALETTE,
	BRAND_SHADER_LUMINAR_PANEL_ROSE_PALETTE,
	BRAND_SHADER_LUMINAR_PANEL_SOFT_PALETTE,
	BRAND_SHADER_LUMINAR_PANEL_VIVID_PALETTE,
} from "../../lib/brand-shader-palette.js";
import {
	buildBrandShaderPanelPreset,
	type BrandShaderPanelPreset,
} from "../../lib/brand-shader-panel-preset.js";
import type { SidebarUpdateKind } from "./types.js";

/** Gradient-only variants for the sidebar update card. */
export type SidebarUpdateCardVariant =
	| "luminar-blob"
	| "luminar-wave"
	| "luminar-corners"
	| "luminar-ripple"
	| "luminar-dots"
	| "acepe-warm"
	| "luminar-vivid"
	| "luminar-soft"
	| "luminar-rose"
	| "luminar-pill";

export type SidebarUpdateCardSurfaceTokens = "light" | "dark";

export interface SidebarUpdateCardVariantDefinition {
	readonly id: SidebarUpdateCardVariant;
	readonly label: string;
	readonly description: string;
	readonly shellClass: string;
	readonly ctaClass: string;
	readonly panelPreset: BrandShaderPanelPreset;
	readonly surfaceTokens: SidebarUpdateCardSurfaceTokens;
}

export const SIDEBAR_UPDATE_CARD_VARIANTS: readonly SidebarUpdateCardVariantDefinition[] = [
	{
		id: "luminar-blob",
		label: "Luminar blob",
		description: "Default iridescent mix — balanced pink, blue, peach, and violet blobs.",
		shellClass: "rounded-lg shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_10px_28px_rgba(0,0,0,0.1)]",
		ctaClass: "shrink-0 bg-white text-black hover:bg-muted hover:text-foreground",
		panelPreset: buildBrandShaderPanelPreset({
			palette: BRAND_SHADER_LUMINAR_PANEL_PALETTE,
			shape: "blob",
			scale: 1,
		}),
		surfaceTokens: "light",
	},
	{
		id: "luminar-wave",
		label: "Luminar wave",
		description: "Horizontal wave bands — more directional flow across the card.",
		shellClass: "rounded-lg shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.08)]",
		ctaClass: "shrink-0 bg-white text-black hover:bg-muted hover:text-foreground",
		panelPreset: buildBrandShaderPanelPreset({
			palette: BRAND_SHADER_LUMINAR_PANEL_PALETTE,
			shape: "wave",
			scale: 1.35,
		}),
		surfaceTokens: "light",
	},
	{
		id: "luminar-corners",
		label: "Luminar corners",
		description: "Color pools in each corner — vignette-like framing.",
		shellClass: "rounded-lg shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_10px_28px_rgba(0,0,0,0.1)]",
		ctaClass: "shrink-0 bg-white text-black hover:bg-muted hover:text-foreground",
		panelPreset: buildBrandShaderPanelPreset({
			palette: BRAND_SHADER_LUMINAR_PANEL_PALETTE,
			shape: "corners",
			scale: 0.9,
		}),
		surfaceTokens: "light",
	},
	{
		id: "luminar-ripple",
		label: "Luminar ripple",
		description: "Concentric ripples from center — radial iridescent rings.",
		shellClass: "rounded-xl shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_12px_32px_rgba(0,0,0,0.12)]",
		ctaClass: "shrink-0 bg-white text-black hover:bg-muted hover:text-foreground",
		panelPreset: buildBrandShaderPanelPreset({
			palette: BRAND_SHADER_LUMINAR_PANEL_PALETTE,
			shape: "ripple",
			scale: 1.15,
		}),
		surfaceTokens: "light",
	},
	{
		id: "luminar-dots",
		label: "Luminar dots",
		description: "Grainy dot lattice — finer texture, speckled iridescence.",
		shellClass: "rounded-lg shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.08)]",
		ctaClass: "shrink-0 bg-white text-black hover:bg-muted hover:text-foreground",
		panelPreset: buildBrandShaderPanelPreset({
			palette: BRAND_SHADER_LUMINAR_PANEL_PALETTE,
			shape: "dots",
			scale: 1.25,
		}),
		surfaceTokens: "light",
	},
	{
		id: "acepe-warm",
		label: "Acepe warm",
		description: "Dark orange Acepe grain — brand heat on a charcoal base.",
		shellClass: "rounded-lg shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_10px_28px_rgba(0,0,0,0.35)]",
		ctaClass: "shrink-0 bg-white text-black hover:bg-white/90",
		panelPreset: buildBrandShaderPanelPreset({
			palette: BRAND_SHADER_ACEPE_PANEL_PALETTE,
			shape: "blob",
			scale: 1,
		}),
		surfaceTokens: "dark",
	},
	{
		id: "luminar-vivid",
		label: "Luminar vivid",
		description: "Higher contrast and saturation — punchy color separation.",
		shellClass: "rounded-lg shadow-[0_0_0_1px_rgba(0,0,0,0.08),0_12px_32px_rgba(0,0,0,0.14)]",
		ctaClass: "shrink-0 bg-white text-black hover:bg-muted hover:text-foreground",
		panelPreset: buildBrandShaderPanelPreset({
			palette: BRAND_SHADER_LUMINAR_PANEL_VIVID_PALETTE,
			shape: "blob",
			scale: 1.15,
		}),
		surfaceTokens: "light",
	},
	{
		id: "luminar-soft",
		label: "Luminar soft",
		description: "Low-contrast dreamy wash — gentle, pastel iridescence.",
		shellClass: "rounded-xl shadow-[0_0_0_1px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.06)]",
		ctaClass: "shrink-0 bg-white/95 text-black hover:bg-white",
		panelPreset: buildBrandShaderPanelPreset({
			palette: BRAND_SHADER_LUMINAR_PANEL_SOFT_PALETTE,
			shape: "blob",
			scale: 0.95,
		}),
		surfaceTokens: "light",
	},
	{
		id: "luminar-rose",
		label: "Luminar rose",
		description: "Pink-forward palette with wave motion in the grain.",
		shellClass: "rounded-lg shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_10px_28px_rgba(255,120,180,0.12)]",
		ctaClass: "shrink-0 bg-white text-black hover:bg-muted hover:text-foreground",
		panelPreset: buildBrandShaderPanelPreset({
			palette: BRAND_SHADER_LUMINAR_PANEL_ROSE_PALETTE,
			shape: "wave",
			scale: 1.2,
		}),
		surfaceTokens: "light",
	},
	{
		id: "luminar-pill",
		label: "Luminar pill",
		description: "Capsule silhouette with zoomed blob — compact promo strip.",
		shellClass: "rounded-full shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_8px_20px_rgba(0,0,0,0.08)]",
		ctaClass: "shrink-0 h-6 rounded-full bg-white px-2.5 text-[10px] text-black hover:bg-muted hover:text-foreground",
		panelPreset: buildBrandShaderPanelPreset({
			palette: BRAND_SHADER_LUMINAR_PANEL_PALETTE,
			shape: "blob",
			scale: 1.4,
		}),
		surfaceTokens: "light",
	},
];

export const DEFAULT_SIDEBAR_UPDATE_CARD_VARIANT: SidebarUpdateCardVariant = "luminar-wave";

const variantById: Readonly<Record<SidebarUpdateCardVariant, SidebarUpdateCardVariantDefinition>> =
	SIDEBAR_UPDATE_CARD_VARIANTS.reduce(
		(acc, definition) => {
			acc[definition.id] = definition;
			return acc;
		},
		{} as Record<SidebarUpdateCardVariant, SidebarUpdateCardVariantDefinition>,
	);

export function getSidebarUpdateCardVariantDefinition(
	variant: SidebarUpdateCardVariant,
): SidebarUpdateCardVariantDefinition {
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
			title: `Installing ${roundedPercent}%`,
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
