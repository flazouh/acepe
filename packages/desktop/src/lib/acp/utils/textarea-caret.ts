/**
 * Utility for calculating cursor (caret) position in a textarea.
 * Uses the "mirror div" technique to measure text and determine pixel coordinates.
 */

export interface CaretCoordinates {
	top: number;
	left: number;
	height: number;
}

/**
 * CSS properties that affect text rendering and must be copied to the mirror div.
 */
const MIRROR_PROPERTIES = [
	"fontFamily",
	"fontSize",
	"fontWeight",
	"fontStyle",
	"letterSpacing",
	"textTransform",
	"wordSpacing",
	"textIndent",
	"whiteSpace",
	"wordWrap",
	"wordBreak",
	"paddingLeft",
	"paddingRight",
	"paddingTop",
	"paddingBottom",
	"borderLeftWidth",
	"borderRightWidth",
	"borderTopWidth",
	"borderBottomWidth",
	"boxSizing",
	"lineHeight",
] as const;

/**
 * Calculate the pixel position of the caret in a textarea.
 * Uses a hidden mirror div with identical styling to measure text.
 *
 * @param textarea - The textarea element
 * @param position - The character position (0-indexed) to measure
 * @returns Coordinates relative to the textarea's content area
 */
export function getCaretCoordinates(
	textarea: HTMLTextAreaElement,
	position: number
): CaretCoordinates {
	const mirror = document.createElement("div");
	const style = getComputedStyle(textarea);

	// Position mirror off-screen at a fixed location
	mirror.style.position = "absolute";
	mirror.style.top = "0";
	mirror.style.left = "0";
	mirror.style.visibility = "hidden";
	mirror.style.whiteSpace = "pre-wrap";
	mirror.style.wordWrap = "break-word";
	mirror.style.width = `${textarea.offsetWidth}px`;
	mirror.style.overflow = "hidden";

	// Copy text-affecting styles to mirror
	for (const prop of MIRROR_PROPERTIES) {
		const value = style.getPropertyValue(prop.replace(/([A-Z])/g, "-$1").toLowerCase());
		if (value) {
			mirror.style.setProperty(prop.replace(/([A-Z])/g, "-$1").toLowerCase(), value);
		}
	}

	// Insert text up to cursor position
	const textBeforeCursor = textarea.value.substring(0, position);

	// Create a text node for the content before cursor
	const textNode = document.createTextNode(textBeforeCursor);
	mirror.appendChild(textNode);

	// Add a marker span at the cursor position
	const marker = document.createElement("span");
	marker.textContent = "\u200B"; // Zero-width space to get position without affecting layout
	mirror.appendChild(marker);

	// Add remaining text (needed for proper wrapping calculation)
	const textAfterCursor = textarea.value.substring(position);
	if (textAfterCursor) {
		mirror.appendChild(document.createTextNode(textAfterCursor));
	}

	document.body.appendChild(mirror);

	// Use offsetLeft/offsetTop within the mirror for accurate measurement
	// This avoids issues with getBoundingClientRect when mirror is positioned elsewhere
	const coordinates: CaretCoordinates = {
		top: marker.offsetTop - textarea.scrollTop,
		left: marker.offsetLeft - textarea.scrollLeft,
		height: Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.2,
	};

	// Cleanup
	document.body.removeChild(mirror);

	return coordinates;
}
