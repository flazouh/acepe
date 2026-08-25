import { fromPromise } from "@acepe/effect-result/fromPromise";
import * as Effect from "effect/Effect";

import { createLogger } from "../../../utils/logger.js";

import { ClipboardError } from "../errors";

const logger = createLogger({ id: "clipboard-manager", name: "ClipboardManager" });

function copyTextWithExecCommand(content: string): boolean {
	if (typeof document === "undefined") {
		return false;
	}

	const textarea = document.createElement("textarea");
	textarea.value = content;
	textarea.setAttribute("readonly", "true");
	textarea.style.position = "fixed";
	textarea.style.opacity = "0";
	textarea.style.pointerEvents = "none";
	document.body.append(textarea);
	textarea.select();
	textarea.setSelectionRange(0, content.length);
	const copied = document.execCommand("copy");
	textarea.remove();

	return copied;
}

export function copyTextToClipboard(content: string): Effect.Effect<void, ClipboardError> {
	logger.info("copyTextToClipboard: attempting clipboard write", {
		contentLength: content.length,
	});

	const clipboard = typeof navigator === "undefined" ? null : navigator.clipboard;
	if (clipboard) {
		return fromPromise(
			() => clipboard.writeText(content),
			(error) =>
				new ClipboardError("Failed to copy to clipboard", {
					contentLength: content.length,
					originalError: String(error),
					fallback: "navigator.clipboard",
				})
		).pipe(
			Effect.map(() => {
				logger.info("copyTextToClipboard: navigator clipboard write succeeded", {
					contentLength: content.length,
				});
			}),
			Effect.catch((navigatorError) => {
				logger.warn("copyTextToClipboard: navigator clipboard write failed", {
					contentLength: content.length,
					error: navigatorError.message,
					context: navigatorError.context,
				});
				return copyWithExecCommand(content);
			})
		);
	}

	return copyWithExecCommand(content);
}

function copyWithExecCommand(content: string): Effect.Effect<void, ClipboardError> {
	const copied = copyTextWithExecCommand(content);
	if (copied) {
		logger.info("copyTextToClipboard: execCommand fallback succeeded", {
			contentLength: content.length,
		});
		return Effect.succeed(undefined);
	}

	logger.error("copyTextToClipboard: execCommand fallback failed", {
		contentLength: content.length,
	});
	return Effect.fail(
		new ClipboardError("Failed to copy to clipboard", {
			contentLength: content.length,
			fallback: "execCommand",
		})
	);
}
