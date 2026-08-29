/**
 * Design-system token catalogue.
 *
 * Pure data. Every entry names a CSS custom property that really exists in
 * `packages/website/src/routes/layout.css` or `@acepe/ui/design-tokens.css`.
 * The page resolves each value from the live document, so a swatch can never
 * drift from the stylesheet — rename a token and the swatch goes blank.
 */

export interface TokenEntry {
	/** CSS custom property name, without the leading `--`. */
	readonly name: string;
	/** What the token is for, in one line. */
	readonly usage: string;
	/** Paired foreground token, when the swatch should preview text on it. */
	readonly on?: string;
	/**
	 * Tailwind utility that applies the token. Radius steps live in `@theme
	 * inline`, which inlines them into utilities instead of emitting runtime
	 * custom properties, so the preview must use the class and measure back.
	 */
	readonly utility?: string;
}

export interface TokenGroup {
	readonly id: string;
	readonly title: string;
	readonly description: string;
	readonly tokens: readonly TokenEntry[];
}

export const surfaceTokens: TokenGroup = {
	id: "surfaces",
	title: "Surfaces",
	description: "The stack of backgrounds, from the app shell up to floating panels.",
	tokens: [
		{ name: "background", usage: "App canvas behind everything.", on: "foreground" },
		{ name: "card", usage: "Raised block: panels, list rows, cards.", on: "card-foreground" },
		{
			name: "popover",
			usage: "Floating layer: menus, popovers, tooltips.",
			on: "popover-foreground",
		},
		{ name: "sidebar", usage: "Navigation rail and session list.", on: "sidebar-foreground" },
		{
			name: "muted",
			usage: "Recessed fill for inert or secondary blocks.",
			on: "muted-foreground",
		},
	],
};

export const actionTokens: TokenGroup = {
	id: "actions",
	title: "Actions",
	description: "Interactive fills. Primary carries the brand; the rest step down in weight.",
	tokens: [
		{ name: "primary", usage: "Highest-intent action, one per view.", on: "primary-foreground" },
		{
			name: "secondary",
			usage: "Supporting action next to a primary.",
			on: "secondary-foreground",
		},
		{ name: "accent", usage: "Hover and active fill for ghost controls.", on: "accent-foreground" },
	],
};

export const statusTokens: TokenGroup = {
	id: "status",
	title: "Status",
	description: "Outcome colours. Never decorative — each one asserts a state.",
	tokens: [
		{
			name: "destructive",
			usage: "Errors and irreversible actions.",
			on: "destructive-foreground",
		},
		{ name: "success", usage: "Completed work, passing checks.", on: "success-foreground" },
		{ name: "build-icon", usage: "Build and tool-run accent." },
		{ name: "plan-icon", usage: "Plan mode accent." },
		{ name: "cursor-status-error", usage: "Session needs attention: failed." },
		{ name: "cursor-status-warning", usage: "Session needs attention: waiting." },
		{ name: "cursor-status-success", usage: "Session finished cleanly." },
	],
};

export const lineTokens: TokenGroup = {
	id: "lines",
	title: "Lines and focus",
	description: "Hairlines and the focus ring. These carry most of the app's structure.",
	tokens: [
		{ name: "border", usage: "Dividers and component outlines." },
		{ name: "input", usage: "Field borders and inert control fills." },
		{ name: "ring", usage: "Keyboard focus ring." },
	],
};

export const chartTokens: TokenGroup = {
	id: "charts",
	title: "Data",
	description: "Categorical series for usage meters and charts. Use in order.",
	tokens: [
		{ name: "chart-1", usage: "Series 1." },
		{ name: "chart-2", usage: "Series 2." },
		{ name: "chart-3", usage: "Series 3." },
		{ name: "chart-4", usage: "Series 4." },
		{ name: "chart-5", usage: "Series 5." },
	],
};

/** Brand constants — the same value in every theme, by design. */
export const brandTokens: TokenGroup = {
	id: "brand",
	title: "Brand constants",
	description: "Shipped by @acepe/ui. These do not change between light and dark.",
	tokens: [
		{ name: "token-brand-primary", usage: "Acepe accent.", on: "token-brand-primary-foreground" },
		{ name: "token-success-light", usage: "Reference green, light themes." },
		{ name: "token-success-dark", usage: "Reference green, dark themes." },
		{ name: "token-plan-icon-light", usage: "Plan orange, light themes." },
		{ name: "token-download-progress", usage: "Install and download progress fill." },
	],
};

export const colorGroups: readonly TokenGroup[] = [
	surfaceTokens,
	actionTokens,
	statusTokens,
	lineTokens,
	chartTokens,
	brandTokens,
];

export const radiusTokens: readonly TokenEntry[] = [
	{ name: "radius-sm", usage: "Kbd, tags, dense chips.", utility: "rounded-sm" },
	{ name: "radius-md", usage: "Buttons, inputs, menu items.", utility: "rounded-md" },
	{ name: "radius-lg", usage: "Cards and panels. The base --radius.", utility: "rounded-lg" },
	{ name: "radius-xl", usage: "Dialogs and large surfaces.", utility: "rounded-xl" },
];

export const shadowTokens: readonly TokenEntry[] = [
	{ name: "shadow-xs", usage: "Switch and other inline controls." },
	{ name: "shadow-sm", usage: "Resting card lift." },
	{ name: "shadow-md", usage: "Hovered card, popover." },
	{ name: "shadow-lg", usage: "Dropdown menus." },
	{ name: "shadow-xl", usage: "Dialogs." },
	{ name: "shadow-2xl", usage: "Spotlight and command palette." },
];

export const fontTokens: readonly TokenEntry[] = [
	{ name: "font-display", usage: "Marketing headings. Matter." },
	{ name: "font-sans", usage: "All interface text." },
	{ name: "font-mono", usage: "Code, diffs, token names." },
];

export const durationTokens: readonly TokenEntry[] = [
	{ name: "duration-stagger", usage: "Per-item offset in a list reveal." },
	{ name: "duration-micro", usage: "Tooltip delay, shake segment." },
	{ name: "duration-quick", usage: "Menu close, text swap." },
	{ name: "duration-fast", usage: "Menu open, icon swap, page slide." },
	{ name: "duration-medium", usage: "Panel close, toast close." },
	{ name: "duration-slow", usage: "Panel open, skeleton reveal." },
	{ name: "duration-very-slow", usage: "Emphasis: badge appear, success check." },
];

export const easeTokens: readonly TokenEntry[] = [
	{ name: "ease-smooth-out", usage: "Open and close for panels, menus, modals." },
	{ name: "ease-in-out", usage: "Swaps and reveals." },
	{ name: "ease-out", usage: "Tooltips." },
	{ name: "ease-linear", usage: "Shimmer, pulse, spinner." },
	{ name: "ease-bounce", usage: "Badge pop." },
	{ name: "ease-bounce-strong", usage: "Avatar hover return." },
];

/** Read a token's computed value off an element. Returns "" when undefined. */
export function resolveToken(name: string, element: Element): string {
	return getComputedStyle(element).getPropertyValue(`--${name}`).trim();
}

/** Every token this page claims exists, for the drift test. */
export function allDeclaredTokenNames(): readonly string[] {
	return [
		...colorGroups.flatMap((group) =>
			group.tokens.flatMap((token) => (token.on ? [token.name, token.on] : [token.name]))
		),
		...radiusTokens.map((t) => t.name),
		...shadowTokens.map((t) => t.name),
		...fontTokens.map((t) => t.name),
		...durationTokens.map((t) => t.name),
		...easeTokens.map((t) => t.name),
	];
}
