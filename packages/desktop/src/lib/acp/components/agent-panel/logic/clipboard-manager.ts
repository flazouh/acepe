import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { errAsync, okAsync, ResultAsync } from "neverthrow";

import type { SessionCold, SessionEntry } from "../../../application/dto/session";
import { createLogger } from "../../../utils/logger.js";

import { ClipboardError } from "../errors";

const logger = createLogger({ id: "clipboard-manager", name: "ClipboardManager" });

/**
 * Data needed to copy a session to clipboard.
 */
interface ClipboardSessionData extends SessionCold {
	readonly entries: ReadonlyArray<SessionEntry>;
	readonly entryCount: number;
}

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

export function copyTextToClipboard(content: string): ResultAsync<void, ClipboardError> {
	logger.info("copyTextToClipboard: attempting Tauri clipboard write", {
		contentLength: content.length,
	});

	return ResultAsync.fromPromise(
		writeText(content),
		(error) =>
			new ClipboardError("Failed to copy to clipboard", {
				contentLength: content.length,
				originalError: String(error),
			})
	)
		.map(() => {
			logger.info("copyTextToClipboard: Tauri clipboard write succeeded", {
				contentLength: content.length,
			});
		})
		.orElse((tauriError) => {
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

				return ResultAsync.fromPromise(
					clipboardWrite,
					(error) =>
						new ClipboardError("Failed to copy to clipboard", {
							contentLength: content.length,
							originalError: String(error),
							fallback: "navigator.clipboard",
						})
				)
					.map(() => {
						logger.info("copyTextToClipboard: navigator clipboard write succeeded", {
							contentLength: content.length,
						});
					})
					.orElse((navigatorError) => {
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
							return okAsync(undefined);
						}

						logger.error("copyTextToClipboard: execCommand fallback failed", {
							contentLength: content.length,
						});

						return errAsync(
							new ClipboardError("Failed to copy to clipboard", {
								contentLength: content.length,
								fallback: "execCommand",
							})
						);
					});
			}

			logger.warn("copyTextToClipboard: navigator clipboard unavailable, using execCommand", {
				contentLength: content.length,
			});

			const copied = copyTextWithExecCommand(content);

			if (copied) {
				logger.info("copyTextToClipboard: execCommand fallback succeeded", {
					contentLength: content.length,
				});
				return okAsync(undefined);
			}

			logger.error("copyTextToClipboard: execCommand fallback failed", {
				contentLength: content.length,
			});

			return errAsync(
				new ClipboardError("Failed to copy to clipboard", {
					contentLength: content.length,
					fallback: "execCommand",
				})
			);
	});
}

/**
 * Copies session content to clipboard as formatted JSON.
 *
 * @param session - Session cold data + entries to copy
 * @returns Result indicating success or failure
 *
 * @example
 * ```ts
 * copySessionToClipboard({ ...cold, entries, entryCount: entries.length }).match(
 *   () => console.log("Copied!"),
 *   (err) => console.error("Failed:", err)
 * );
 * ```
 */
export function copySessionToClipboard(
	session: ClipboardSessionData
): ResultAsync<void, ClipboardError> {
	const content = JSON.stringify(session, null, 2);

	return copyTextToClipboard(content);
}
