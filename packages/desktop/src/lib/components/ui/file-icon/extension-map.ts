/**
 * Re-exports from @acepe/ui with desktop base path (/svgs/icons).
 * Desktop static assets are served from this path.
 */
import {
	extensionToIcon,
	filenameToIcon,
	getFallbackIconSrc as getFallbackIconSrcFromUi,
	getFileIconName,
	getFileIconSrc as getFileIconSrcFromUi,
	getFilenameIconName,
	getFolderIconSrc as getFolderIconSrcFromUi,
	getSpecialFolderIconSrc as getSpecialFolderIconSrcFromUi,
} from "@acepe/ui/file-icon";

const ICON_BASE_PATH = "/svgs/icons";

export { extensionToIcon, filenameToIcon, getFileIconName, getFilenameIconName };

export function getFileIconSrc(filenameOrExtension: string): string {
	return getFileIconSrcFromUi(filenameOrExtension, ICON_BASE_PATH);
}

export function getFallbackIconSrc(): string {
	return getFallbackIconSrcFromUi(ICON_BASE_PATH);
}

export function getFolderIconSrc(isOpen: boolean = false): string {
	return getFolderIconSrcFromUi(isOpen, ICON_BASE_PATH);
}

export function getSpecialFolderIconSrc(folderName: string, isOpen: boolean = false): string {
	return getSpecialFolderIconSrcFromUi(folderName, isOpen, ICON_BASE_PATH);
}
