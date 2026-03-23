/**
 * File icon utilities.
 *
 * This module re-exports from the centralized file-icon component.
 * Use the new FileIcon component directly for rendering icons.
 *
 * @deprecated Import from "$lib/components/ui/file-icon" instead
 */
export {
	getFallbackIconSrc,
	getFileIconName,
	getFileIconSrc,
	getFilenameIconName,
	getFolderIconSrc,
	getSpecialFolderIconSrc,
} from "$lib/components/ui/file-icon/index.js";

import { getFileIconSrc as _getFileIconSrc } from "$lib/components/ui/file-icon/index.js";

/**
 * @deprecated Use getFileIconSrc() instead
 */
export function getFileIconPath(extension: string): string {
	// This function previously returned MDI path strings.
	// Now it returns the SVG source path for backward compatibility.
	return _getFileIconSrc(extension);
}

/**
 * @deprecated Use getFallbackIconSrc() instead
 */
export function getFallbackFileIconPath(): string {
	return "/svgs/icons/file.svg";
}
