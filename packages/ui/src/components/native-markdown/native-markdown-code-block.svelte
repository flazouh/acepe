<script lang="ts" module>
	import { errAsync, ResultAsync } from "neverthrow";
	import type { ThemeRegistrationAny } from "shiki";

	interface CursorCodeThemes {
		readonly dark: ThemeRegistrationAny;
		readonly light: ThemeRegistrationAny;
	}

	const CODE_LANGUAGE_ALIAS: Record<string, string> = {
		bash: "sh",
		shell: "sh",
		zsh: "sh",
		javascript: "js",
		typescript: "ts",
		golang: "go",
	};
	const CODE_LANGUAGE_LABEL: Record<string, string> = {
		css: "CSS",
		go: "Go",
		html: "HTML",
		js: "JavaScript",
		json: "JSON",
		jsonc: "JSONC",
		md: "Markdown",
		py: "Python",
		rs: "Rust",
		sh: "Shell",
		sql: "SQL",
		svelte: "Svelte",
		ts: "TypeScript",
		tsx: "TSX",
		yaml: "YAML",
		yml: "YAML",
	};
	const CODE_START_LINE_META_PATTERN = /startLine=(\d+)/u;
	const CODE_NO_LINE_NUMBERS_META_PATTERN = /\bnoLineNumbers\b/u;

	let cursorCodeThemesPromise: Promise<CursorCodeThemes> | null = null;

	function normalizeCodeLanguage(language: string): string {
		const normalized = language.trim().toLowerCase();
		return CODE_LANGUAGE_ALIAS[normalized] ?? normalized;
	}

	function getCodeLanguageLabel(language: string): string {
		if (language.length === 0) {
			return "Text";
		}
		return CODE_LANGUAGE_LABEL[language] ?? language;
	}

	function extractCodeStartLine(meta: string): number | undefined {
		const line = CODE_START_LINE_META_PATTERN.exec(meta)?.[1];
		if (line === undefined) {
			return undefined;
		}

		const startLine = Number.parseInt(line, 10);
		return startLine >= 1 ? startLine : undefined;
	}

	function writeClipboardText(text: string): ResultAsync<void, Error> {
		const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
		if (clipboard === undefined || typeof clipboard.writeText !== "function") {
			return errAsync(new Error("Clipboard API not available"));
		}

		return ResultAsync.fromPromise(
			clipboard.writeText(text),
			(error) => new Error(`Failed to copy code block: ${String(error)}`),
		);
	}

	function fetchCursorTheme(path: string, label: string): ResultAsync<ThemeRegistrationAny, Error> {
		const href =
			typeof window === "undefined" ? path : new URL(path, window.location.origin).toString();
		return ResultAsync.fromPromise(
			fetch(href).then((response) => {
				if (!response.ok) {
					throw new Error(`Failed to load ${label} Cursor theme: ${response.status}`);
				}
				return response.json() as Promise<ThemeRegistrationAny>;
			}),
			(error) => (error instanceof Error ? error : new Error(String(error))),
		);
	}

	function loadCursorCodeThemes(): ResultAsync<CursorCodeThemes, Error> {
		if (cursorCodeThemesPromise === null) {
			cursorCodeThemesPromise = fetchCursorTheme("/themes/cursor-light.theme.json", "light")
				.andThen((light) =>
					fetchCursorTheme("/themes/cursor.theme.json", "dark").map((dark) => ({
						dark,
						light,
					})),
				)
				.match(
					(themes) => themes,
					(error) => {
						cursorCodeThemesPromise = null;
						throw error;
					},
				);
		}

		return ResultAsync.fromPromise(
			cursorCodeThemesPromise,
			(error) => (error instanceof Error ? error : new Error(String(error))),
		);
	}

	function highlightCode(
		code: string,
		normalizedLanguage: string,
	): ResultAsync<string, Error> {
		return ResultAsync.fromPromise(
			import("shiki"),
			(error) => new Error(`Failed to load code highlighter: ${String(error)}`),
		).andThen((shiki) =>
			loadCursorCodeThemes().andThen((themes) =>
				ResultAsync.fromPromise(
					shiki.codeToHtml(code, {
						lang: normalizedLanguage || "text",
						themes: {
							light: themes.light,
							dark: themes.dark,
						},
						defaultColor: false,
					}),
					(error) => new Error(`Failed to highlight code block: ${String(error)}`),
				),
			),
		);
	}
</script>

<script lang="ts">
	import { RoundedIcon } from "../icons/index.js";
	import { onDestroy } from "svelte";

	import { getFallbackIconSrc, getFileIconSrc } from "../../lib/file-icon/index.js";
	import { cn } from "../../lib/utils.js";

	interface Props {
		code: string;
		language: string;
		meta: string;
		isIncomplete: boolean;
	}

	let { code, language, meta, isIncomplete }: Props = $props();

	const normalizedLanguage = $derived(normalizeCodeLanguage(language));
	const languageLabel = $derived(getCodeLanguageLabel(normalizedLanguage));
	const languageIconSrc = $derived(
		normalizedLanguage.length === 0 ? getFallbackIconSrc() : getFileIconSrc(normalizedLanguage),
	);
	const lineNumbers = $derived(!CODE_NO_LINE_NUMBERS_META_PATTERN.test(meta));
	const startLine = $derived(extractCodeStartLine(meta));
	const codeCounterStyle = $derived(
		lineNumbers && startLine !== undefined
			? `counter-reset: line ${String(startLine - 1)};`
			: lineNumbers
				? "counter-reset: line;"
				: undefined,
	);
	const highlightedHtmlPromise = $derived.by(() => {
		if (isIncomplete) {
			return Promise.resolve(null);
		}

		return highlightCode(code, normalizedLanguage).match(
			(html) => html,
			(error) => {
				console.error(error.message);
				return null;
			},
		);
	});

	let copied = $state(false);
	let copiedTimeoutId: number | null = null;

	onDestroy(() => {
		if (copiedTimeoutId !== null) {
			window.clearTimeout(copiedTimeoutId);
		}
	});

	function handleCopyClick(event: MouseEvent): void {
		event.preventDefault();
		event.stopPropagation();

		if (!code.trim()) {
			console.warn("Cannot copy empty code block");
			return;
		}

		const copyText = code.endsWith("\n") ? code : `${code}\n`;
		void writeClipboardText(copyText).match(
			() => {
				copied = true;
				if (copiedTimeoutId !== null) {
					window.clearTimeout(copiedTimeoutId);
				}
				copiedTimeoutId = window.setTimeout(() => {
					copied = false;
					copiedTimeoutId = null;
				}, 1500);
			},
			(error) => {
				console.error("Failed to copy code block", error);
			},
		);
	}
</script>

<div
	class="my-2 overflow-hidden rounded-lg border border-border/70 bg-input/24 !gap-0 !p-0"
	data-language={normalizedLanguage}
	data-native-markdown="code-block"
>
	<div
		role="group"
		class="flex h-6 items-center justify-between border-b border-border pl-2 pr-1.5 text-sm"
		data-acepe-code-language={normalizedLanguage || "text"}
		data-native-markdown="code-block-header"
	>
		<div class="flex min-w-0 flex-1 items-center gap-1">
			<div class="flex min-w-0 items-center gap-1 text-muted-foreground" title={languageLabel}>
				<img
					alt=""
					class="h-3.5 w-3.5 shrink-0 object-contain"
					src={languageIconSrc}
				/>
				<span class="min-w-0 truncate font-mono text-[0.6875rem] leading-none">
					{languageLabel}
				</span>
			</div>
		</div>
		<div class="ml-1.5 flex shrink-0 items-center gap-1.5" data-native-markdown="code-block-actions">
			<button
				aria-label={copied ? "Copied code" : "Copy code"}
				class={cn(
					"flex cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent p-0.5 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground",
					copied ? "text-success" : "",
				)}
				data-acepe-code-copy-button="true"
				data-copy-state={copied ? "copied" : "idle"}
				onclick={handleCopyClick}
				title={copied ? "Copied!" : "Copy code"}
				type="button"
			>
				{#if copied}
					<RoundedIcon name="check" class="size-3.5" />
				{:else}
					<RoundedIcon name="copy" class="size-3.5" />
				{/if}
			</button>
		</div>
	</div>
	<div
		class="border-0 rounded-none bg-transparent px-2.5 py-2 text-[0.8125rem] !leading-normal language-{normalizedLanguage ||
			'text'}"
		data-native-markdown="code-block-body"
	>
		{#await highlightedHtmlPromise then highlightedHtml}
			{#if highlightedHtml}
				<div
					data-acepe-code-highlighted="true"
					data-acepe-code-line-numbers={lineNumbers ? "true" : "false"}
					style={codeCounterStyle}
				>
					{@html highlightedHtml}
				</div>
			{:else}
				<pre
					class="!m-0 !p-0 rounded-none bg-transparent text-inherit !text-[0.8125rem] !leading-normal language-{normalizedLanguage ||
						'text'}"
				><code style={codeCounterStyle}>{code}</code></pre>
			{/if}
		{/await}
	</div>
</div>
