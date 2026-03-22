import type { StructuredData } from "../types.js";

import { normalizeStructuredData } from "./structured.js";

type XmlNode = {
	tag: string;
	attrs: Record<string, string>;
	children: XmlNode[];
	text: string[];
};

type StructuredCandidate =
	| (string | number | boolean | null)
	| Date
	| StructuredCandidate[]
	| {
			[key: string]: StructuredCandidate;
	  };

export function parseXmlToStructured(content: string): StructuredData {
	const tokens = content.match(/<[^>]+>|[^<]+/g) ?? [];
	const stack: XmlNode[] = [];
	let root: XmlNode | null = null;

	for (const token of tokens) {
		const trimmed = token.trim();
		if (trimmed.length === 0) {
			continue;
		}

		if (trimmed.startsWith("<?") || trimmed.startsWith("<!")) {
			continue;
		}

		if (trimmed.startsWith("</")) {
			stack.pop();
			continue;
		}

		if (trimmed.startsWith("<")) {
			const selfClosing = trimmed.endsWith("/>");
			const inner = trimmed.slice(1, selfClosing ? -2 : -1).trim();
			const parts = inner.split(/\s+/);
			const tag = parts[0] ?? "node";
			const attrs = parseXmlAttributes(inner.slice(tag.length));

			const node: XmlNode = { tag, attrs, children: [], text: [] };
			if (stack.length > 0) {
				const parent = stack[stack.length - 1];
				parent.children.push(node);
			} else {
				root = node;
			}

			if (!selfClosing) {
				stack.push(node);
			}

			continue;
		}

		if (stack.length > 0) {
			stack[stack.length - 1].text.push(trimmed);
		}
	}

	if (root === null) {
		return { xml: "" };
	}

	return normalizeStructuredData(convertXmlNode(root));
}

function parseXmlAttributes(input: string): Record<string, string> {
	const attrs: Record<string, string> = {};
	const matches = input.match(/([A-Za-z_:][\w:.-]*)\s*=\s*"([^"]*)"/g) ?? [];
	for (const match of matches) {
		const groups = /([A-Za-z_:][\w:.-]*)\s*=\s*"([^"]*)"/.exec(match);
		if (groups) {
			attrs[groups[1]] = groups[2];
		}
	}
	return attrs;
}

function convertXmlNode(node: XmlNode): StructuredCandidate {
	const children = node.children.map((child) => convertXmlNode(child));
	return {
		tag: node.tag,
		attributes: node.attrs,
		text: node.text.join(" "),
		children,
	};
}
