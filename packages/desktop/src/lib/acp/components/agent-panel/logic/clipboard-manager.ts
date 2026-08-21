import { fromPromise } from "@acepe/effect-result/fromPromise";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
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
	logger.info("copyTextToClipboard: attempting Tauri clipboard write", {
		contentLength: content.length,
	});

	return fromPromise(
		() => writeText(content),
		(error) =>
			new ClipboardError("Failed to copy to clipboard", {
				contentLength: content.length,
				originalError: String(error),
			})
	).pipe(
		Effect.map(() => {
			logger.info("copyTextToClipboard: Tauri clipboard write succeeded", {
				contentLength: content.length,
			});
		}),
		Effect.catch((tauriError) => {
			logger.warn("copyTextToClipboard: Tauri clipboard write failed", {
				contentLength: content.length,
				error: tauriError.message,
				context: tauriError.context,
			});

			const clipboard = typeof navigator === "undefined" ? null : navigator.clipboard;
			const clipboardWrite = clipboard ? clipboard.writeText(content) : null;

			if (clipboardWrite) {
				logger.info("copyTextToClipboard: attempting navigator clipboard write", {
					contentLength: content.length,
				});

				return fromPromise(
					() => clipboardWrite,
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
					})
				);
			}

			logger.warn("copyTextToClipboard: navigator clipboard unavailable, using execCommand", {
				contentLength: content.length,
			});

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
		})
	);
}
