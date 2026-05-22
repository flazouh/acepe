import {
	defaultUrlTransform,
	type StreamdownProps,
	type UrlTransform,
} from "streamdown";

import type { StreamingAnimationMode } from "../../lib/assistant-message/types.js";

export type AcepeStreamdownPhase = "streaming" | "settled";

export interface AcepeStreamdownConfigInput {
	readonly phase: AcepeStreamdownPhase;
	readonly streamingAnimationMode: StreamingAnimationMode;
}

export interface AcepeStreamdownConfig {
	readonly mode: NonNullable<StreamdownProps["mode"]>;
	readonly parseIncompleteMarkdown: boolean;
	readonly animated: StreamdownProps["animated"];
	readonly remend: StreamdownProps["remend"];
	readonly urlTransform: UrlTransform;
}

const BLOCKED_URL_PROTOCOL_PATTERN = /^(?:javascript|data|file|blob|vbscript):/iu;
const URL_PROTOCOL_PATTERN = /^[a-z][a-z0-9+.-]*:/iu;

export const STREAMDOWN_SMOOTH_ANIMATION = {
	animation: "acepeTokenReveal",
	duration: 630,
	easing: "cubic-bezier(0.16, 1, 0.3, 1)",
	sep: "word",
	stagger: 0,
} satisfies Exclude<StreamdownProps["animated"], boolean | undefined>;

export function acepeStreamdownUrlTransform(
	url: string,
	key: string,
	node: Parameters<UrlTransform>[2]
): string | null | undefined {
	const trimmedUrl = url.trim();
	if (BLOCKED_URL_PROTOCOL_PATTERN.test(trimmedUrl)) {
		return null;
	}

	if (!URL_PROTOCOL_PATTERN.test(trimmedUrl) && !trimmedUrl.startsWith("//")) {
		return trimmedUrl;
	}

	return defaultUrlTransform(trimmedUrl, key, node);
}

export function createAcepeStreamdownConfig(
	input: AcepeStreamdownConfigInput
): AcepeStreamdownConfig {
	const isStreaming = input.phase === "streaming";
	const shouldAnimate =
		isStreaming && input.streamingAnimationMode === "smooth";

	return {
		mode: isStreaming ? "streaming" : "static",
		parseIncompleteMarkdown: isStreaming,
		animated: shouldAnimate ? STREAMDOWN_SMOOTH_ANIMATION : false,
		remend: {},
		urlTransform: acepeStreamdownUrlTransform,
	};
}
