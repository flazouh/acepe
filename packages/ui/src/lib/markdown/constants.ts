/**
 * Supported programming languages for syntax highlighting.
 * Used by Shiki in the markdown renderer.
 */
export const SUPPORTED_LANGUAGES = [
	"typescript",
	"javascript",
	"python",
	"html",
	"css",
	"json",
	"markdown",
	"rust",
	"go",
	"java",
	"cpp",
	"c",
	"php",
	"ruby",
	"swift",
	"text",
	"bash",
	"sh",
	"shell",
	"svelte",
	"tsx",
	"jsx",
	"vue",
	"yaml",
	"toml",
	"sql",
	"graphql",
] as const;

/** Base badge classes for status badges */
export const BADGE_BASE_CLASSES =
	"inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-muted text-muted-foreground";

/** Phosphor CheckCircle (fill) icon - green (var(--success): #17803D light / #16db95 dark) */
const ICON_COMPLETED = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="var(--success)" viewBox="0 0 256 256"><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm45.66,85.66-56,56a8,8,0,0,1-11.32,0l-24-24a8,8,0,0,1,11.32-11.32L112,148.69l50.34-50.35a8,8,0,0,1,11.32,11.32Z"></path></svg>`;

/** Phosphor Circle (outline) icon - currentColor (muted) */
const ICON_PENDING = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 256 256"><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Z"></path></svg>`;

/** Phosphor Copy icon (fill weight) */
const COPY_ICON = `<svg class="copy-icon" xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 256 256"><path d="M216,32H88a8,8,0,0,0-8,8V80H40a8,8,0,0,0-8,8V216a8,8,0,0,0,8,8H168a8,8,0,0,0,8-8V176h40a8,8,0,0,0,8-8V40A8,8,0,0,0,216,32Zm-8,128H176V88a8,8,0,0,0-8-8H96V48H208Z"></path></svg>`;

/** Phosphor CheckCircle icon (fill weight) - green (var(--success)) */
const CHECK_ICON = `<svg class="check-icon" xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="var(--success)" viewBox="0 0 256 256"><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm45.66,85.66-56,56a8,8,0,0,1-11.32,0l-24-24a8,8,0,0,1,11.32-11.32L112,148.69l50.34-50.35a8,8,0,0,1,11.32,11.32Z"></path></svg>`;

export function createCompletedBadgeHtml(label: string): string {
	return `<span class="${BADGE_BASE_CLASSES}">${ICON_COMPLETED}${label}</span>`;
}

export function createPendingBadgeHtml(label: string): string {
	return `<span class="${BADGE_BASE_CLASSES}">${ICON_PENDING}${label}</span>`;
}

export function createColorBadgeHtml(hexColor: string): string {
	return `<span class="color-badge"><span class="color-swatch" style="background-color:${hexColor}"></span><code>${hexColor}</code><button type="button" class="color-copy-btn" data-color="${hexColor}" title="Copy color">${COPY_ICON}${CHECK_ICON}</button></span>`;
}
