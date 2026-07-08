import type { InlineArtefactTokenType } from "../../lib/inline-artefact/index.js";

export const INLINE_ARTEFACT_PACKAGE_PATH =
	"M223.68,66.15,135.68,18a15.88,15.88,0,0,0-15.36,0l-88,48.17a16,16,0,0,0-8.32,14v95.64a16,16,0,0,0,8.32,14l88,48.17a15.88,15.88,0,0,0,15.36,0l88-48.17a16,16,0,0,0,8.32-14V80.18A16,16,0,0,0,223.68,66.15ZM128,32l80.35,44L178.57,92.29l-80.35-44Zm0,88L47.65,76,81.56,57.43l80.35,44Zm88,55.85h0l-80,43.79V133.83l32-17.51V152a8,8,0,0,0,16,0V107.56l32-17.51v85.76Z";

export const INLINE_ARTEFACT_CLIPBOARD_PATH =
	"M200,32H163.74a47.92,47.92,0,0,0-71.48,0H56A16,16,0,0,0,40,48V216a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V48A16,16,0,0,0,200,32Zm-72,0a32,32,0,0,1,32,32H96A32,32,0,0,1,128,32Zm32,128H96a8,8,0,0,1,0-16h64a8,8,0,0,1,0,16Zm0-32H96a8,8,0,0,1,0-16h64a8,8,0,0,1,0,16Z";

export function buildInlineArtefactIconClassName(tokenType: InlineArtefactTokenType): string {
	if (tokenType === "command" || tokenType === "skill") {
		return "text-purple";
	}

	if (tokenType === "text" || tokenType === "text_ref") {
		return "text-success";
	}

	return "";
}

export function buildInlineArtefactLabelClassName(tokenType: InlineArtefactTokenType): string {
	const isSlashItem = tokenType === "command" || tokenType === "skill";
	const maxWidthClass = isSlashItem ? "max-w-[180px]" : "max-w-[120px]";
	const fontClass = tokenType === "command" ? "font-mono" : "";

	return `${maxWidthClass} truncate ${fontClass} text-foreground leading-none`.trim();
}
