/**
 * Session menu actions: clipboard, Finder, raw log, Acepe file panel — async side effects for agent panel.
 */

import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { toast } from "svelte-sonner";
import { openFileInEditor } from "$lib/utils/tauri-client/opener.js";
import { revealInFinder, tauriClient } from "$lib/utils/tauri-client.js";
import type { SessionExportContentError } from "../../../store/session-graph-builders.js";
import type { createLogger } from "../../../utils/logger.js";
import { copyTextToClipboard } from "../logic/clipboard-manager.js";
import { getOpenInFinderTarget } from "../logic/open-in-finder-target.js";

type Logger = ReturnType<typeof createLogger>;

export async function copyThreadContentToClipboard(args: {
	sessionId: string;
	getSessionJsonExportContent: (
		id: string
	) => Result.Result<string, SessionExportContentError>;
}): Promise<void> {
	const { sessionId, getSessionJsonExportContent } = args;
	await Effect.runPromise(
		Effect.fromResult(getSessionJsonExportContent(sessionId)).pipe(
			Effect.flatMap((content) => copyTextToClipboard(content)),
			Effect.match({
				onSuccess: () => toast.success("Thread content copied to clipboard"),
				onFailure: (error) => toast.error(error.message),
			})
		)
	);
}

export async function openSessionInFinder(args: {
	sessionId: string | null;
	projectPath: string | null | undefined;
	agentId: string | null | undefined;
	sourcePath: string | null | undefined;
}): Promise<void> {
	const target = getOpenInFinderTarget({
		sessionId: args.sessionId,
		projectPath: args.projectPath,
		agentId: args.agentId,
		sourcePath: args.sourcePath,
	});

	if (!target) {
		toast.error("No thread to open");
		return;
	}

	await Effect.runPromise(
		revealInFinder(target.path).pipe(
			Effect.catch(() => {
				toast.error("Failed to open thread in Finder");
				return Effect.succeed(undefined);
			})
		)
	);
}

export async function openStreamingLog(sessionId: string | null): Promise<void> {
	if (!sessionId) {
		toast.error("No thread to export");
		return;
	}

	await Effect.runPromise(
		tauriClient.shell.openStreamingLog(sessionId).pipe(
			Effect.match({
				onSuccess: () => undefined,
				onFailure: (error) => toast.error(`Failed to open streaming log: ${error.message}`),
			})
		)
	);
}

export async function copyStreamingLogPathToClipboard(args: {
	sessionId: string | null;
	logger: Logger;
}): Promise<void> {
	const { sessionId, logger } = args;
	if (!sessionId) {
		logger.warn("copyStreamingLogPathToClipboard: no session id");
		toast.error("No thread to export");
		return;
	}

	logger.info("copyStreamingLogPathToClipboard: requesting streaming log path", { sessionId });

	await Effect.runPromise(
		tauriClient.shell.getStreamingLogPath(sessionId).pipe(
			Effect.flatMap((path) => {
				logger.info("copyStreamingLogPathToClipboard: received streaming log path", {
					sessionId,
					path,
				});

				return copyTextToClipboard(path);
			}),
			Effect.match({
				onSuccess: () => {
					logger.info("copyStreamingLogPathToClipboard: copy succeeded", { sessionId });
					toast.success("Path copied to clipboard");
				},
				onFailure: (error) => {
					logger.error("copyStreamingLogPathToClipboard: copy failed", {
						sessionId,
						error: error.message,
					});
					toast.error("Failed to copy path");
				},
			})
		)
	);
}

export async function openSessionRawFileInEditor(args: {
	sessionId: string | null;
	sessionProjectPath: string | null | undefined;
}): Promise<void> {
	const { sessionId, sessionProjectPath } = args;
	if (!sessionId || !sessionProjectPath) return;
	await Effect.runPromise(
		tauriClient.shell.getSessionFilePath(sessionId, sessionProjectPath).pipe(
			Effect.flatMap((path) => openFileInEditor(path)),
			Effect.match({
				onSuccess: () => toast.success("Opened streaming log in file manager"),
				onFailure: (err) => toast.error(`Failed to open session file: ${err.message}`),
			})
		)
	);
}

export async function openSessionFileInAcepePanel(args: {
	sessionId: string | null;
	sessionProjectPath: string | null | undefined;
	effectivePanelId: string | undefined;
	openFilePanel: (
		fileName: string,
		dirPath: string,
		opts: { ownerPanelId: string | undefined }
	) => void;
}): Promise<void> {
	const { sessionId, sessionProjectPath, effectivePanelId, openFilePanel } = args;
	if (!sessionId || !sessionProjectPath) return;
	await Effect.runPromise(
		tauriClient.shell.getSessionFilePath(sessionId, sessionProjectPath).pipe(
			Effect.match({
				onSuccess: (fullPath) => {
					const parts = fullPath.split(/[/\\]/);
					const fileName = parts.pop() ?? fullPath;
					const dirPath = parts.join("/") || "/";
					openFilePanel(fileName, dirPath, { ownerPanelId: effectivePanelId });
				},
				onFailure: (err) => toast.error(`Failed to open session file: ${err.message}`),
			})
		)
	);
}

export async function exportSessionMarkdownToClipboard(markdown: string): Promise<void> {
	await Effect.runPromise(
		copyTextToClipboard(markdown).pipe(
			Effect.match({
				onSuccess: () => toast.success("Copied to clipboard"),
				onFailure: (err) => toast.error(`Failed to export: ${err.message}`),
			})
		)
	);
}

export async function exportSessionJsonToClipboard(args: {
	sessionId: string;
	getSessionJsonExportContent: (
		id: string
	) => Result.Result<string, SessionExportContentError>;
}): Promise<void> {
	const { sessionId, getSessionJsonExportContent } = args;
	await Effect.runPromise(
		Effect.fromResult(getSessionJsonExportContent(sessionId)).pipe(
			Effect.flatMap((content) => copyTextToClipboard(content)),
			Effect.match({
				onSuccess: () => toast.success("Copied to clipboard"),
				onFailure: (error) => toast.error(`Failed to export: ${error.message}`),
			})
		)
	);
}
