import {
	buildChipShellClassName,
	buildInlineArtefactIconClassName,
	buildInlineArtefactLabelClassName,
	INLINE_ARTEFACT_CLIPBOARD_PATH,
	INLINE_ARTEFACT_PACKAGE_PATH,
} from "@acepe/ui";
import { getFallbackIconSrc, getFileIconSrc } from "$lib/components/ui/file-icon/extension-map.js";

import {
	type InlineArtefactTokenType,
	tokenizeInlineArtefacts,
} from "./inline-artefact-segments.js";

const TOKEN_ATTR_TYPE = "data-inline-token-type";
const TOKEN_ATTR_VALUE = "data-inline-token-value";

export function toInlineTokenText(tokenType: InlineArtefactTokenType, value: string): string {
	return `@[${tokenType}:${value}]`;
}

function labelForToken(
	tokenType: InlineArtefactTokenType,
	value: string,
	meta?: { textPreview?: string; charCount?: number }
): string {
	if (tokenType === "file" || tokenType === "image") {
		const fileName = value.split("/").pop();
		return fileName && fileName.length > 0 ? fileName : value;
	}
	if (tokenType === "command") {
		return value.startsWith("/") ? value : `/${value}`;
	}
	if (tokenType === "skill") {
		const normalized = value.startsWith("/") ? value.slice(1) : value;
		return normalized.length > 0 ? normalized : "Skill";
	}
	if (meta?.textPreview) {
		return meta.textPreview;
	}
	return "Pasted text";
}

function createTextFragment(content: string): DocumentFragment {
	const fragment = document.createDocumentFragment();
	const segments = content.split("\n");
	for (let i = 0; i < segments.length; i += 1) {
		const segment = segments[i];
		if (segment.length > 0) {
			fragment.appendChild(document.createTextNode(segment));
		}
		if (segment.length === 0 && segments.length > 1) {
			fragment.appendChild(document.createTextNode("\u200B"));
		}
		if (i < segments.length - 1) {
			fragment.appendChild(document.createElement("br"));
		}
	}
	return fragment;
}

function createTokenElement(
	tokenType: InlineArtefactTokenType,
	value: string,
	meta?: { textPreview?: string; charCount?: number }
): HTMLSpanElement {
	const element = document.createElement("span");
	element.setAttribute(TOKEN_ATTR_TYPE, tokenType);
	element.setAttribute(TOKEN_ATTR_VALUE, value);
	element.setAttribute("contenteditable", "false");
	const isFile = tokenType === "file" || tokenType === "image";
	const isTextRef = tokenType === "text_ref";

	element.className = buildChipShellClassName({ density: "inline", interactive: isFile });

	const icon = createTokenIcon(tokenType, value);

	const label = document.createElement("span");
	label.className = buildInlineArtefactLabelClassName(tokenType);
	label.textContent = labelForToken(tokenType, value, meta);

	element.appendChild(icon);
	element.appendChild(label);

	if (isTextRef && meta?.charCount != null) {
		const count = document.createElement("span");
		count.className = "text-[10px] text-muted-foreground/50";
		count.textContent = `${meta.charCount}c`;
		element.appendChild(count);
	}

	const remove = document.createElement("button");
	remove.type = "button";
	remove.className =
		"ml-0.5 p-0.5 rounded hover:bg-destructive/20 hover:text-destructive cursor-pointer transition-colors";
	remove.setAttribute("data-inline-remove", "true");
	remove.setAttribute("aria-label", "Remove artefact");
	remove.appendChild(createRemoveIcon());
	element.appendChild(remove);

	return element;
}

function createSvgIcon(path: string, className: string, stroke = "currentColor"): SVGElement {
	const ns = "http://www.w3.org/2000/svg";
	const svg = document.createElementNS(ns, "svg");
	svg.setAttribute("viewBox", "0 0 24 24");
	svg.setAttribute("fill", "none");
	svg.setAttribute("stroke", stroke);
	svg.setAttribute("stroke-width", "2");
	svg.setAttribute("stroke-linecap", "round");
	svg.setAttribute("stroke-linejoin", "round");
	svg.setAttribute("class", className);

	const commands = path.split("|");
	for (const d of commands) {
		const p = document.createElementNS(ns, "path");
		p.setAttribute("d", d);
		svg.appendChild(p);
	}
	return svg;
}

function createPhosphorPathIcon(path: string, className: string): SVGElement {
	const ns = "http://www.w3.org/2000/svg";
	const svg = document.createElementNS(ns, "svg");
	svg.setAttribute("viewBox", "0 0 256 256");
	svg.setAttribute("fill", "currentColor");
	svg.setAttribute("class", className);
	const p = document.createElementNS(ns, "path");
	p.setAttribute("d", path);
	svg.appendChild(p);
	return svg;
}

function createFileTypeIcon(source: string, className: string): HTMLImageElement {
	const img = document.createElement("img");
	img.alt = "";
	img.className = className;
	img.setAttribute("aria-hidden", "true");
	img.onerror = () => {
		img.src = getFallbackIconSrc();
	};
	img.src = getFileIconSrc(source);
	return img;
}

function createTokenIcon(tokenType: InlineArtefactTokenType, value: string): Element {
	const iconClassName = ["h-3.5 w-3.5 shrink-0", buildInlineArtefactIconClassName(tokenType)]
		.filter((part) => part.length > 0)
		.join(" ");

	if (tokenType === "command" || tokenType === "skill") {
		return createPhosphorPathIcon(INLINE_ARTEFACT_PACKAGE_PATH, iconClassName);
	}
	if (tokenType === "text" || tokenType === "text_ref") {
		return createPhosphorPathIcon(INLINE_ARTEFACT_CLIPBOARD_PATH, iconClassName);
	}
	return createFileTypeIcon(value, "h-3.5 w-3.5 shrink-0");
}

function createRemoveIcon(): SVGElement {
	return createSvgIcon("M18 6 6 18|M6 6l12 12", "h-3 w-3");
}

function isTokenElement(node: Node): node is HTMLElement {
	return (
		node.nodeType === Node.ELEMENT_NODE &&
		(node as HTMLElement).hasAttribute(TOKEN_ATTR_TYPE) &&
		(node as HTMLElement).hasAttribute(TOKEN_ATTR_VALUE)
	);
}

function getNodeSerializedLength(node: Node): number {
	if (node.nodeType === Node.TEXT_NODE) {
		return (node.textContent ?? "").replace(/\u200B/g, "").length;
	}
	if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === "BR") {
		return 1;
	}
	if (isTokenElement(node)) {
		const tokenType = node.getAttribute(TOKEN_ATTR_TYPE) as InlineArtefactTokenType;
		const value = node.getAttribute(TOKEN_ATTR_VALUE) ?? "";
		return toInlineTokenText(tokenType, value).length;
	}
	let length = 0;
	for (const child of Array.from(node.childNodes)) {
		length += getNodeSerializedLength(child);
	}
	return length;
}

export function serializeInlineComposerMessage(editor: HTMLElement): string {
	let result = "";
	const bareBreakOnly =
		editor.childNodes.length === 1 &&
		editor.firstChild?.nodeType === Node.ELEMENT_NODE &&
		(editor.firstChild as HTMLElement).tagName === "BR";
	if (bareBreakOnly) {
		return "";
	}
	const walker = document.createTreeWalker(editor, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
	let node = walker.nextNode();

	while (node) {
		if (node.nodeType === Node.TEXT_NODE) {
			result += (node.textContent ?? "").replace(/\u200B/g, "");
			node = walker.nextNode();
			continue;
		}

		if (node.nodeType !== Node.ELEMENT_NODE) {
			node = walker.nextNode();
			continue;
		}

		const element = node as HTMLElement;
		if (element.tagName === "BR") {
			result += "\n";
			node = walker.nextNode();
			continue;
		}

		if (isTokenElement(element)) {
			const tokenType = element.getAttribute(TOKEN_ATTR_TYPE) as InlineArtefactTokenType;
			const value = element.getAttribute(TOKEN_ATTR_VALUE) ?? "";
			result += toInlineTokenText(tokenType, value);

			const next = element.nextSibling;
			if (next) {
				walker.currentNode = next;
				node = next;
				continue;
			}
			let parent: Node | null = element.parentNode;
			while (parent && !parent.nextSibling) {
				parent = parent.parentNode;
			}
			if (parent?.nextSibling) {
				walker.currentNode = parent.nextSibling;
				node = parent.nextSibling;
				continue;
			}
			break;
		}

		node = walker.nextNode();
	}

	return result;
}

export function getInlineTokenType(element: Element): InlineArtefactTokenType | null {
	const value = element.getAttribute(TOKEN_ATTR_TYPE);
	if (
		value === "file" ||
		value === "image" ||
		value === "text" ||
		value === "text_ref" ||
		value === "command" ||
		value === "skill"
	) {
		return value;
	}
	return null;
}

export function getInlineTokenValue(element: Element): string | null {
	return element.getAttribute(TOKEN_ATTR_VALUE);
}

function resolveTokenCandidate(node: Node | null): HTMLElement | null {
	if (!node) {
		return null;
	}
	if (isTokenElement(node)) {
		return node;
	}
	return null;
}

export function getAdjacentInlineTokenElement(
	editor: HTMLElement,
	range: Range,
	direction: "backward" | "forward"
): HTMLElement | null {
	const container = range.startContainer;
	const offset = range.startOffset;
	if (!editor.contains(container)) {
		return null;
	}

	if (container.nodeType === Node.TEXT_NODE) {
		const text = container.textContent ?? "";
		if (direction === "backward") {
			if (offset !== 0) {
				return null;
			}
			return resolveTokenCandidate(container.previousSibling);
		}
		if (offset !== text.length) {
			return null;
		}
		return resolveTokenCandidate(container.nextSibling);
	}

	if (container.nodeType === Node.ELEMENT_NODE) {
		const element = container as Element;
		const children = Array.from(element.childNodes);
		if (direction === "backward") {
			if (offset <= 0 || offset > children.length) {
				return null;
			}
			return resolveTokenCandidate(children[offset - 1] ?? null);
		}
		if (offset < 0 || offset >= children.length) {
			return null;
		}
		return resolveTokenCandidate(children[offset] ?? null);
	}

	return null;
}

export function getSerializedRangeForNode(
	editor: HTMLElement,
	node: Node
): { start: number; end: number } | null {
	if (!editor.contains(node)) {
		return null;
	}

	// Walk editor's direct children to compute the serialized offset before
	// the target node and its length, without cloning any DOM subtrees.
	let start = 0;
	let found = false;
	for (const child of editor.childNodes) {
		if (child === node || child.contains(node)) {
			found = true;
			break;
		}
		start += getNodeSerializedLength(child);
	}
	if (!found) {
		return null;
	}
	const end = start + getNodeSerializedLength(node);
	return { start, end };
}

export function renderInlineComposerMessage(
	editor: HTMLElement,
	message: string,
	resolveTokenMeta?: (
		type: InlineArtefactTokenType,
		value: string
	) => { textPreview?: string; charCount?: number } | undefined
): void {
	editor.innerHTML = "";
	for (const segment of tokenizeInlineArtefacts(message)) {
		if (segment.kind === "text") {
			editor.appendChild(createTextFragment(segment.text));
			continue;
		}
		const meta = resolveTokenMeta?.(segment.tokenType, segment.value);
		editor.appendChild(createTokenElement(segment.tokenType, segment.value, meta));
	}
}

/**
 * Computes the offset within a single node up to a given child-text position.
 * Used by getSerializedCursorOffset to avoid cloneContents().
 */
function getSerializedOffsetWithinNode(
	node: Node,
	targetContainer: Node,
	targetOffset: number
): number {
	if (node === targetContainer) {
		if (node.nodeType === Node.TEXT_NODE) {
			return (node.textContent ?? "").slice(0, targetOffset).replace(/\u200B/g, "").length;
		}
		// Element node — targetOffset is a child index
		let length = 0;
		const children = node.childNodes;
		for (let i = 0; i < targetOffset && i < children.length; i++) {
			length += getNodeSerializedLength(children[i]);
		}
		return length;
	}

	// Recurse into children, accumulating lengths for children that precede
	// the one containing the target, and recursing into the containing child.
	let length = 0;
	for (const child of node.childNodes) {
		if (child === targetContainer || child.contains(targetContainer)) {
			length += getSerializedOffsetWithinNode(child, targetContainer, targetOffset);
			break;
		}
		length += getNodeSerializedLength(child);
	}
	return length;
}

export function getSerializedCursorOffset(editor: HTMLElement): number {
	const selection = window.getSelection();
	if (!selection || selection.rangeCount === 0) {
		return 0;
	}
	const range = selection.getRangeAt(0);
	if (!editor.contains(range.startContainer)) {
		return 0;
	}
	// Walk the live DOM in-place instead of cloning the pre-caret subtree.
	return getSerializedOffsetWithinNode(editor, range.startContainer, range.startOffset);
}

export function getSerializedSelectionRange(
	editor: HTMLElement
): { start: number; end: number } | null {
	const selection = window.getSelection();
	if (!selection || selection.rangeCount === 0) {
		return null;
	}

	const range = selection.getRangeAt(0);
	if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) {
		return null;
	}

	const start = getSerializedOffsetWithinNode(editor, range.startContainer, range.startOffset);
	const end = getSerializedOffsetWithinNode(editor, range.endContainer, range.endOffset);

	return { start, end };
}

export function getSerializedSelectionEnd(editor: HTMLElement, collapsedOffset: number): number {
	const selection = window.getSelection();
	if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
		return collapsedOffset;
	}
	const serializedRange = getSerializedSelectionRange(editor);
	if (!serializedRange) {
		return collapsedOffset;
	}
	return serializedRange.end;
}

export function setSerializedCursorOffset(editor: HTMLElement, offset: number): void {
	let remaining = Math.max(0, offset);
	let node: ChildNode | null = editor.firstChild;

	while (node) {
		const length = getNodeSerializedLength(node);
		if (remaining <= length) {
			const selection = window.getSelection();
			const range = document.createRange();

			if (node.nodeType === Node.TEXT_NODE) {
				range.setStart(node, remaining);
				range.collapse(true);
				selection?.removeAllRanges();
				selection?.addRange(range);
				return;
			}

			if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === "BR") {
				const next = node.nextSibling;
				if (next && next.nodeType === Node.TEXT_NODE) {
					range.setStart(next, 0);
				} else {
					range.setStartAfter(node);
				}
				range.collapse(true);
				selection?.removeAllRanges();
				selection?.addRange(range);
				return;
			}

			if (isTokenElement(node)) {
				if (remaining === 0) {
					range.setStartBefore(node);
				} else {
					const nextSibling = node.nextSibling;
					if (nextSibling && nextSibling.nodeType === Node.TEXT_NODE) {
						range.setStart(nextSibling, 0);
					} else if (!nextSibling) {
						// Keep the caret on the same line as a trailing chip by anchoring it
						// inside an invisible text node instead of after the non-editable span.
						const spacer = document.createTextNode("\u200B");
						editor.appendChild(spacer);
						range.setStart(spacer, 0);
					} else {
						range.setStartAfter(node);
					}
				}
				range.collapse(true);
				selection?.removeAllRanges();
				selection?.addRange(range);
				return;
			}
		}

		remaining -= length;
		node = node.nextSibling;
	}

	const fallbackSelection = window.getSelection();
	const fallbackRange = document.createRange();
	fallbackRange.selectNodeContents(editor);
	fallbackRange.collapse(false);
	fallbackSelection?.removeAllRanges();
	fallbackSelection?.addRange(fallbackRange);
}
