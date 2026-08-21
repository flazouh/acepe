import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fromPromise } from "@acepe/effect-result/fromPromise";
import { fromThrowable } from "@acepe/effect-result/fromThrowable";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

export type HmrUiProbeFailure = {
	readonly code: string;
	readonly message: string;
};

export type HmrUiProbeResult = {
	readonly editedFile: string;
	readonly editedBasename: string;
	readonly viteDevUrl: string;
	readonly hmrWebSocketUrl: string;
	readonly updatePaths: readonly string[];
	readonly svelteUpdatePaths: readonly string[];
	readonly duplicateModuleIdentity: boolean;
	readonly probeAttributeApplied: boolean;
};

export type HmrUiProbeOptions = {
	readonly checkoutRoot: string;
	readonly viteDevUrl?: string;
	readonly relativeUiFile?: string;
	readonly timeoutMs?: number;
};

const DEFAULT_RELATIVE_UI_FILE =
	"packages/ui/src/components/usage-widget/usage-vertical-meter.svelte";
const PROBE_ATTRIBUTE = "data-hmr-probe";
const PROBE_ATTRIBUTE_VALUE = "acepe-ui-hmr-probe";

function dependencyFailure(code: string, message: string): HmrUiProbeFailure {
	return { code, message };
}

function normalizeBasename(filePath: string): string {
	const segments = filePath.split(/[/\\]/);
	return segments[segments.length - 1] ?? filePath;
}

async function fetchViteHmrToken(
	viteDevUrl: string
): Promise<Result.Result<string, HmrUiProbeFailure>> {
	const clientUrl = `${viteDevUrl.replace(/\/$/, "")}/@vite/client`;
	const response = await fetch(clientUrl);
	if (!response.ok) {
		return Result.fail(
			dependencyFailure(
				"vite_client_unavailable",
				`Unable to fetch ${clientUrl} (${response.status.toString()}).`
			)
		);
	}
	const source = await response.text();
	const tokenMatch =
		/const wsToken = "([A-Za-z0-9_-]+)"/.exec(source) ?? /token=([A-Za-z0-9_-]+)/.exec(source);
	if (tokenMatch === null || tokenMatch[1] === undefined) {
		return Result.fail(
			dependencyFailure(
				"vite_hmr_token_missing",
				`Could not parse HMR token from ${clientUrl}. Is the Vite dev server running?`
			)
		);
	}
	return Result.succeed(tokenMatch[1]);
}

function buildHmrWebSocketUrl(viteDevUrl: string, token: string): string {
	const parsed = new URL(viteDevUrl);
	const protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
	return `${protocol}//${parsed.host}/?token=${token}`;
}

type HmrUpdatePayload = {
	readonly type?: string;
	readonly updates?: readonly { readonly path?: string }[];
};

const parseHmrPayload = fromThrowable(
	(input: string) => JSON.parse(input) as HmrUpdatePayload,
	() => null
);

function watchHmrUpdatesAfterEdit(input: {
	readonly webSocketUrl: string;
	readonly editedFile: string;
	readonly nextSource: string;
	readonly timeoutMs: number;
	readonly viteDevUrl: string;
}): Effect.Effect<readonly string[], HmrUiProbeFailure> {
	return fromPromise(
		() =>
			new Promise<readonly string[]>((resolvePromise, rejectPromise) => {
				const collectedPaths: string[] = [];
				const socket = new WebSocket(input.webSocketUrl, "vite-hmr");
				let editApplied = false;

				const finish = (paths: readonly string[]) => {
					clearTimeout(timeoutHandle);
					if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
						socket.close();
					}
					resolvePromise(paths);
				};

				const timeoutHandle = setTimeout(() => {
					finish(collectedPaths);
				}, input.timeoutMs);

				socket.addEventListener("open", () => {
					const moduleUrl = `${input.viteDevUrl.replace(/\/$/, "")}/@fs${input.editedFile}`;
					void fetch(moduleUrl).finally(() => {
						setTimeout(() => {
							if (!editApplied) {
								editApplied = true;
								writeFileSync(input.editedFile, input.nextSource, "utf8");
							}
						}, 500);
					});
				});

				socket.addEventListener("message", (event) => {
					const payload = typeof event.data === "string" ? event.data : "";
					if (payload.length === 0) {
						return;
					}
					const parsed = Effect.runSync(Effect.result(parseHmrPayload(payload)));
					if (Result.isFailure(parsed)) {
						return;
					}
					if (parsed.success.type !== "update" || parsed.success.updates === undefined) {
						return;
					}
					for (const update of parsed.success.updates) {
						if (typeof update.path === "string" && update.path.length > 0) {
							collectedPaths.push(update.path);
						}
					}
				});

				socket.addEventListener("error", () => {
					rejectPromise(
						new Error(`Unable to connect to Vite HMR websocket at ${input.webSocketUrl}.`)
					);
				});
			}),
		(cause) =>
			dependencyFailure(
				"vite_hmr_websocket_failed",
				cause instanceof Error ? cause.message : "Vite HMR websocket connection failed."
			)
	);
}

function applyProbeAttribute(source: string): {
	readonly nextSource: string;
	readonly applied: boolean;
} {
	if (source.includes(`${PROBE_ATTRIBUTE}="${PROBE_ATTRIBUTE_VALUE}"`)) {
		const stripped = removeProbeAttribute(source);
		return { nextSource: stripped, applied: true };
	}
	const marker = "data-usage-vertical-meter";
	const markerIndex = source.indexOf(marker);
	if (markerIndex < 0) {
		return {
			nextSource: source.replace(
				/<div\n\tclass="/,
				`<div\n\t${PROBE_ATTRIBUTE}="${PROBE_ATTRIBUTE_VALUE}"\n\tclass="`
			),
			applied: true,
		};
	}
	const lineStart = source.lastIndexOf("\n", markerIndex) + 1;
	const lineEnd = source.indexOf("\n", markerIndex);
	const line = source.slice(lineStart, lineEnd >= 0 ? lineEnd : source.length);
	if (line.includes(PROBE_ATTRIBUTE)) {
		return { nextSource: source, applied: false };
	}
	const indentMatch = /^(\s*)/.exec(line);
	const indent = indentMatch?.[1] ?? "\t";
	const injectedLine = `${indent}${PROBE_ATTRIBUTE}="${PROBE_ATTRIBUTE_VALUE}"`;
	const nextSource =
		lineEnd >= 0
			? `${source.slice(0, lineStart)}${injectedLine}\n${source.slice(lineStart)}`
			: `${source.slice(0, lineStart)}${injectedLine}\n${source.slice(lineStart)}`;
	return { nextSource, applied: true };
}

function removeProbeAttribute(source: string): string {
	return source
		.replace(new RegExp(`\\s*${PROBE_ATTRIBUTE}="${PROBE_ATTRIBUTE_VALUE}"\\n`, "g"), "\n")
		.replace(new RegExp(`\\s*${PROBE_ATTRIBUTE}="${PROBE_ATTRIBUTE_VALUE}"`, "g"), "");
}

function filterSveltePathsForBasename(
	paths: readonly string[],
	basename: string
): readonly string[] {
	const matches = paths.filter((entry) => entry.endsWith(basename));
	const canonicalPaths = matches.filter((entry) => !entry.includes("/node_modules/@acepe/ui/"));
	return canonicalPaths.length > 0 ? canonicalPaths : matches;
}

export function probeUiPackageHmr(
	options: HmrUiProbeOptions
): Effect.Effect<HmrUiProbeResult, HmrUiProbeFailure> {
	const viteDevUrl = options.viteDevUrl ?? "http://localhost:1420";
	const relativeUiFile = options.relativeUiFile ?? DEFAULT_RELATIVE_UI_FILE;
	const timeoutMs = options.timeoutMs ?? 12_000;
	const editedFile = join(options.checkoutRoot, relativeUiFile);
	const editedBasename = normalizeBasename(editedFile);
	const originalSource = readFileSync(editedFile, "utf8");
	const probeEdit = applyProbeAttribute(originalSource);

	return fromPromise(
		() =>
			(async (): Promise<HmrUiProbeResult> => {
				const tokenResult = await fetchViteHmrToken(viteDevUrl);
				if (Result.isFailure(tokenResult)) {
					throw tokenResult.failure;
				}
				const hmrWebSocketUrl = buildHmrWebSocketUrl(viteDevUrl, tokenResult.success);
				const updatePathsResult = await Effect.runPromise(
					Effect.result(
						watchHmrUpdatesAfterEdit({
							webSocketUrl: hmrWebSocketUrl,
							editedFile,
							nextSource: probeEdit.nextSource,
							timeoutMs,
							viteDevUrl,
						})
					)
				);
				if (Result.isFailure(updatePathsResult)) {
					writeFileSync(editedFile, originalSource, "utf8");
					throw updatePathsResult.failure;
				}
				writeFileSync(editedFile, originalSource, "utf8");
				const updatePaths = updatePathsResult.success;
				const basenameMatches = updatePaths.filter((entry) => entry.endsWith(editedBasename));
				const uniqueBasenameMatches = Array.from(new Set(basenameMatches));
				const svelteUpdatePaths = filterSveltePathsForBasename(updatePaths, editedBasename);
				const uniqueSvelteUpdatePaths = Array.from(new Set(svelteUpdatePaths)).filter(
					(entry) => !entry.includes("/node_modules/@acepe/ui/")
				);
				const duplicateModuleIdentity =
					uniqueBasenameMatches.some((entry) => entry.includes("/node_modules/@acepe/ui/")) &&
					uniqueBasenameMatches.some((entry) => entry.includes("/@fs/"));
				return {
					editedFile,
					editedBasename,
					viteDevUrl,
					hmrWebSocketUrl,
					updatePaths,
					svelteUpdatePaths: uniqueSvelteUpdatePaths,
					duplicateModuleIdentity: duplicateModuleIdentity || uniqueSvelteUpdatePaths.length !== 1,
					probeAttributeApplied: probeEdit.applied,
				};
			})(),
		(cause) =>
			typeof cause === "object" &&
			cause !== null &&
			"code" in cause &&
			"message" in cause &&
			typeof cause.code === "string" &&
			typeof cause.message === "string"
				? { code: cause.code, message: cause.message }
				: dependencyFailure(
						"hmr_probe_failed",
						cause instanceof Error ? cause.message : "HMR probe failed."
					)
	);
}
