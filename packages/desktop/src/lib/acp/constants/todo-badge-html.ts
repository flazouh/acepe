/**
 * HTML strings for todo status badges.
 * Used by markdown renderer and can be referenced for consistency.
 *
 * These use Phosphor icons and match the design system.
 */

/** Base badge classes for all status badges */
export const TODO_BADGE_BASE_CLASSES =
	"inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-muted text-muted-foreground";

/** Phosphor CheckCircle (fill) icon - green (var(--success): #17803D light / #16db95 dark) */
export const TODO_ICON_COMPLETED = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="var(--success)" viewBox="0 0 256 256"><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm45.66,85.66-56,56a8,8,0,0,1-11.32,0l-24-24a8,8,0,0,1,11.32-11.32L112,148.69l50.34-50.35a8,8,0,0,1,11.32,11.32Z"></path></svg>`;

/** Phosphor Circle (outline) icon - currentColor (muted) */
export const TODO_ICON_PENDING = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 256 256"><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Z"></path></svg>`;

/** Phosphor XCircle (fill) icon - currentColor for cancelled status */
export const TODO_ICON_CANCELLED = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 256 256"><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm37.66,130.34a8,8,0,0,1-11.32,11.32L128,139.31l-26.34,26.35a8,8,0,0,1-11.32-11.32L116.69,128,90.34,101.66a8,8,0,0,1,11.32-11.32L128,116.69l26.34-26.35a8,8,0,0,1,11.32,11.32L139.31,128Z"></path></svg>`;

/**
 * Creates a completed badge HTML string.
 * @param label - The label text (e.g., "Done")
 */
export function createCompletedBadgeHtml(label: string): string {
	return `<span class="${TODO_BADGE_BASE_CLASSES}">${TODO_ICON_COMPLETED}${label}</span>`;
}

/**
 * Creates a pending badge HTML string.
 * @param label - The label text (e.g., "Pending")
 */
export function createPendingBadgeHtml(label: string): string {
	return `<span class="${TODO_BADGE_BASE_CLASSES}">${TODO_ICON_PENDING}${label}</span>`;
}

/** Phosphor Copy icon (fill weight) */
const COPY_ICON_FILL = `<svg class="copy-icon" xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 256 256"><path d="M216,32H88a8,8,0,0,0-8,8V80H40a8,8,0,0,0-8,8V216a8,8,0,0,0,8,8H168a8,8,0,0,0,8-8V176h40a8,8,0,0,0,8-8V40A8,8,0,0,0,216,32Zm-8,128H176V88a8,8,0,0,0-8-8H96V48H208Z"></path></svg>`;

/** Phosphor CheckCircle icon (fill weight) - green */
const CHECK_ICON_FILL = `<svg class="check-icon" xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="var(--success)" viewBox="0 0 256 256"><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm45.66,85.66-56,56a8,8,0,0,1-11.32,0l-24-24a8,8,0,0,1,11.32-11.32L112,148.69l50.34-50.35a8,8,0,0,1,11.32,11.32Z"></path></svg>`;

/**
 * Creates a color swatch badge HTML string.
 * Displays a rounded square color preview, hex code, and a copy button.
 * The copy button shows a checkmark after clicking.
 * @param hexColor - The hex color value (e.g., "#FF5D5A")
 */
export function createColorBadgeHtml(hexColor: string): string {
	return `<span class="color-badge"><span class="color-swatch" style="background-color:${hexColor}"></span><code>${hexColor}</code><button type="button" class="color-copy-btn" data-color="${hexColor}" title="Copy color">${COPY_ICON_FILL}${CHECK_ICON_FILL}</button></span>`;
}

const FILE_REFERENCE_WITH_LOCATION_PATTERN = /^(?<path>.+?):(?<line>\d+)(?::(?<column>\d+))?$/;

export interface ParsedFilePathReference {
	filePath: string;
	locationSuffix: string;
}

/**
 * Parse a file reference that may include :line or :line:column suffix.
 */
export function parseFilePathReference(fileReference: string): ParsedFilePathReference {
	const match = FILE_REFERENCE_WITH_LOCATION_PATTERN.exec(fileReference);
	if (!match?.groups?.path || !match.groups.line) {
		return { filePath: fileReference, locationSuffix: "" };
	}

	const { path, line, column } = match.groups;
	const locationSuffix = column ? `:${line}:${column}` : `:${line}`;
	return { filePath: path, locationSuffix };
}
