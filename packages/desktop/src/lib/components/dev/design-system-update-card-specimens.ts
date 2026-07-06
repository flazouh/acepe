import {
	SIDEBAR_UPDATE_CARD_VARIANTS,
	type SidebarUpdateKind,
	type SidebarUpdateCardVariant,
} from "@acepe/ui/app-layout";

export const updateCardSectionMeta = {
	title: "Sidebar update card",
	description:
		"Gradient-only variants for the sidebar update notice. Each specimen renders live at sidebar width (~272px).",
};

export interface UpdateCardStateSpecimen {
	readonly id: string;
	readonly label: string;
	readonly caption: string;
	readonly kind: SidebarUpdateKind;
	readonly version: string | null;
	readonly percent: number;
}

export const updateCardVariantSpecimens = SIDEBAR_UPDATE_CARD_VARIANTS;

export const updateCardStateSpecimens: readonly UpdateCardStateSpecimen[] = [
	{
		id: "available",
		label: "Available",
		caption: "Update ready to install",
		kind: "available",
		version: "2026.4.4",
		percent: 0,
	},
	{
		id: "downloading",
		label: "Downloading",
		caption: "42% · mid-download",
		kind: "downloading",
		version: "2026.4.4",
		percent: 42,
	},
	{
		id: "installing",
		label: "Installing",
		caption: "100% · handoff to installer",
		kind: "installing",
		version: "2026.4.4",
		percent: 100,
	},
	{
		id: "error",
		label: "Error",
		caption: "Download or install failed",
		kind: "error",
		version: null,
		percent: 0,
	},
];

export const featuredUpdateCardVariant: SidebarUpdateCardVariant = "luminar-wave";
