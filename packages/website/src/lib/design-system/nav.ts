export interface NavLink {
	readonly href: string;
	readonly label: string;
	/** In-page anchors, shown when the section is the active route. */
	readonly anchors?: readonly { readonly id: string; readonly label: string }[];
}

export interface NavSection {
	readonly title: string;
	readonly links: readonly NavLink[];
}

export const designSystemNav: readonly NavSection[] = [
	{
		title: "Foundations",
		links: [
			{
				href: "/design-system",
				label: "Palette",
				anchors: [
					{ id: "surfaces", label: "Surfaces" },
					{ id: "actions", label: "Actions" },
					{ id: "status", label: "Status" },
					{ id: "lines", label: "Lines and focus" },
					{ id: "charts", label: "Data" },
					{ id: "brand", label: "Brand constants" },
				],
			},
			{
				href: "/design-system/themes",
				label: "Themes",
				anchors: [
					{ id: "acepe", label: "Acepe" },
					{ id: "anthropic", label: "Anthropic" },
					{ id: "cursor", label: "Cursor" },
					{ id: "one", label: "One" },
				],
			},
			{
				href: "/design-system/foundations",
				label: "Type, shape, motion",
				anchors: [
					{ id: "typography", label: "Typography" },
					{ id: "radius", label: "Radius" },
					{ id: "elevation", label: "Elevation" },
					{ id: "motion", label: "Motion" },
				],
			},
		],
	},
	{
		title: "Components",
		links: [
			{
				href: "/design-system/components",
				label: "Controls",
				anchors: [
					{ id: "button", label: "Button" },
					{ id: "fields", label: "Fields" },
					{ id: "chips", label: "Chips and keys" },
					{ id: "structure", label: "Structure" },
				],
			},
		],
	},
	{
		title: "Studios",
		links: [
			{ href: "/design-system/gradients", label: "Gradients" },
			{ href: "/design-system/icons", label: "Icons" },
			{ href: "/design-system/readme-banner", label: "README banner" },
			{ href: "/design-system/streaming-reveal", label: "Streaming reveal" },
		],
	},
];

/** Longest matching href wins, so `/design-system` does not shadow its children. */
export function activeHref(pathname: string): string {
	const candidates = designSystemNav
		.flatMap((section) => section.links.map((link) => link.href))
		.filter((href) => pathname === href || pathname.startsWith(`${href}/`));

	return candidates.sort((a, b) => b.length - a.length)[0] ?? "";
}
