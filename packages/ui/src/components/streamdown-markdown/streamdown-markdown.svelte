<script lang="ts" module>
	import {
		createElement,
		isValidElement,
		useEffect,
		useRef,
		useState,
		type ComponentProps,
		type MouseEvent as ReactMouseEvent,
		type ReactNode,
		type SyntheticEvent,
	} from "react";
	import { createRoot, type Root } from "react-dom/client";
	import { errAsync, ResultAsync } from "neverthrow";
	import {
		Streamdown,
		defaultRemarkPlugins,
		type Components,
		type ExtraProps,
		type StreamdownProps,
		useIsCodeFenceIncomplete,
	} from "streamdown";
	import type { ThemeRegistrationAny } from "shiki";
	import { buildChipShellClassName } from "../chip/index.js";
	import {
		extensionToIcon,
		getFallbackIconSrc,
		getFileIconSrc,
	} from "../../lib/file-icon/index.js";
	import "../markdown/markdown-prose.css";
	import type {
		StreamdownMarkdownAnimation,
		StreamdownMarkdownMode,
		StreamdownTokenRevealTiming,
	} from "./types.js";
	import {
		createAcepeStreamdownConfig,
		type AcepeStreamdownConfig,
	} from "./streamdown-config.js";
	import { createTokenRevealAnimationResetKey } from "./token-reveal-animation-reset-key.js";
	import { cn } from "../../lib/utils.js";

	const STREAMDOWN_CODE_BLOCK_CLASS = cn(
		"my-2 overflow-hidden !gap-0 !p-0",
		"rounded-lg border border-border/70 bg-input/24"
	);
	const STREAMDOWN_CODE_BLOCK_HEADER_CLASS = cn(
		"flex h-6 items-center justify-between border-b border-border pl-2 pr-1.5 text-sm"
	);
	const STREAMDOWN_CODE_BLOCK_HEADER_LEFT_CLASS = "flex min-w-0 flex-1 items-center gap-1";
	const STREAMDOWN_CODE_BLOCK_HEADER_INNER_CLASS =
		"flex min-w-0 items-center gap-1 text-muted-foreground";
	const ACEPE_CODE_LANGUAGE_ICON_CLASS = "h-3.5 w-3.5 shrink-0 object-contain";
	const ACEPE_CODE_LANGUAGE_LABEL_CLASS =
		"min-w-0 truncate font-mono text-[0.6875rem] leading-none";
	const STREAMDOWN_CODE_BLOCK_HEADER_ACTIONS_CLASS =
		"ml-1.5 flex shrink-0 items-center gap-1.5";
	const ACEPE_CODE_COPY_BUTTON_CLASS = cn(
		"flex items-center justify-center rounded-sm border-0 bg-transparent p-0.5",
		"cursor-pointer text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
	);
	const STREAMDOWN_CODE_BLOCK_BODY_CLASS = cn(
		"border-0 rounded-none bg-transparent px-2.5 py-2 text-[0.8125rem] !leading-normal",
		"[&_pre]:!m-0 [&_pre]:!rounded-none [&_pre]:!bg-transparent [&_pre]:!p-0",
		"[&_pre]:!text-[0.8125rem] [&_pre]:!leading-normal"
	);
	const STREAMDOWN_CODE_BLOCK_BODY_PRE_CLASS =
		"!m-0 !p-0 rounded-none bg-transparent text-inherit !text-[0.8125rem] !leading-normal";

	interface StreamdownActionOptions {
		readonly markdown: string;
		readonly mode: StreamdownMarkdownMode;
		readonly isAnimating: boolean;
		readonly parseIncompleteMarkdown: boolean;
		readonly animated: StreamdownMarkdownAnimation;
		readonly tokenRevealTiming: StreamdownTokenRevealTiming | undefined;
		readonly remend: AcepeStreamdownConfig["remend"];
		readonly urlTransform: AcepeStreamdownConfig["urlTransform"];
		readonly remarkPlugins: NonNullable<StreamdownProps["remarkPlugins"]>;
		readonly animationResetKey: string | undefined;
		readonly onExternalLinkClick: ((url: string) => void) | undefined;
		readonly onFilePathClick: ((filePath: string) => void) | undefined;
	}

	type AnchorProps = ComponentProps<"a"> & ExtraProps;
	type CodeProps = ComponentProps<"code"> & ExtraProps & { readonly "data-block"?: string | boolean };
	type InlineCodeProps = ComponentProps<"code"> & ExtraProps;
	type TableProps = ComponentProps<"table"> & ExtraProps;
	type MarkdownNode = {
		type: string;
		value?: string;
		url?: string;
		title?: string | null;
		children?: MarkdownNode[];
	};
	type MarkdownParentNode = MarkdownNode & { children: MarkdownNode[] };
	type InlineReferenceMatch = {
		readonly index: number;
		readonly endIndex: number;
		readonly label: string;
		readonly href: string;
	};
	type CursorCodeThemes = {
		readonly dark: ThemeRegistrationAny;
		readonly light: ThemeRegistrationAny;
	};
	type ReactNodeWithChildrenProps = {
		readonly children?: ReactNode;
	};

	const KNOWN_FILE_EXTENSION_GROUP = Object.keys(extensionToIcon)
		.map((extension) => extension.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
		.join("|");
	const FILE_REFERENCE_WITH_LOCATION_PATTERN = /^(?<path>.+?):(?<line>\d+)(?::(?<column>\d+))?$/u;
	const CODE_LANGUAGE_PATTERN = /(?:^|\s)language-(?<language>[^\s]+)/u;
	const CODE_START_LINE_META_PATTERN = /startLine=(\d+)/u;
	const CODE_NO_LINE_NUMBERS_META_PATTERN = /\bnoLineNumbers\b/u;
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
	const FILE_PATH_IN_TEXT_PATTERN = new RegExp(
		`(?<!\\S)(\\/?(?:[^/\\s]+\\/)+[^/\\s]+\\.(?:${KNOWN_FILE_EXTENSION_GROUP})(?::\\d+(?::\\d+)?)?)(?!\\S)`,
		"giu"
	);
	const KNOWN_FILE_EXTENSION_PATTERN = new RegExp(
		`(?:^|/)[^/\\s]+\\.(?:${KNOWN_FILE_EXTENSION_GROUP})(?::\\d+(?::\\d+)?)?$`,
		"iu"
	);
	const GITHUB_PR_SHORTHAND_PATTERN = /\b([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)#(\d+)\b/gu;
	const GITHUB_URL_PATTERN =
		/https?:\/\/github\.com\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)\/(pull|issues?)\/(\d+)/giu;
	const ACEPE_REMARK_PLUGINS =
		Object.values(defaultRemarkPlugins).concat(acepeInlineReferenceRemarkPlugin);
	let cursorCodeThemesPromise: Promise<CursorCodeThemes> | null = null;

	function isExternalUrl(href: string): boolean {
		return href.startsWith("http://") || href.startsWith("https://");
	}

	function isCodeBlock(props: CodeProps): boolean {
		return "data-block" in props;
	}

	function extractCodeLanguage(className: string | undefined): string {
		if (className === undefined) {
			return "";
		}

		return CODE_LANGUAGE_PATTERN.exec(className)?.groups?.language ?? "";
	}

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

	function getCodeLanguageIconSrc(language: string): string {
		if (language.length === 0) {
			return getFallbackIconSrc();
		}
		return getFileIconSrc(language);
	}

	function extractCodeMetaString(props: CodeProps): string | undefined {
		const metastring = props.node?.properties?.metastring;
		return typeof metastring === "string" ? metastring : undefined;
	}

	function extractCodeStartLine(meta: string | undefined): number | undefined {
		const line = meta === undefined ? undefined : CODE_START_LINE_META_PATTERN.exec(meta)?.[1];
		if (line === undefined) {
			return undefined;
		}

		const startLine = Number.parseInt(line, 10);
		return startLine >= 1 ? startLine : undefined;
	}

	function reactNodeToText(node: ReactNode): string {
		if (typeof node === "string" || typeof node === "number") {
			return String(node);
		}
		if (Array.isArray(node)) {
			return node.map(reactNodeToText).join("");
		}
		if (isValidElement<ReactNodeWithChildrenProps>(node)) {
			return reactNodeToText(node.props.children);
		}
		return "";
	}

	function writeClipboardText(text: string): ResultAsync<void, Error> {
		const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
		if (clipboard === undefined || typeof clipboard.writeText !== "function") {
			return errAsync(new Error("Clipboard API not available"));
		}

		return ResultAsync.fromPromise(
			clipboard.writeText(text),
			(error) => new Error(`Failed to copy code block: ${String(error)}`)
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
			(error) => (error instanceof Error ? error : new Error(String(error)))
		);
	}

	function loadCursorCodeThemes(): ResultAsync<CursorCodeThemes, Error> {
		if (cursorCodeThemesPromise === null) {
			cursorCodeThemesPromise = fetchCursorTheme("/themes/cursor-light.theme.json", "light")
				.andThen((light) =>
					fetchCursorTheme("/themes/cursor.theme.json", "dark").map((dark) => ({
						dark,
						light,
					}))
				)
				.match(
					(themes) => themes,
					(error) => {
						cursorCodeThemesPromise = null;
						throw error;
					}
				);
		}

		return ResultAsync.fromPromise(
			cursorCodeThemesPromise,
			(error) => (error instanceof Error ? error : new Error(String(error)))
		);
	}

	function isMarkdownParentNode(node: MarkdownNode): node is MarkdownParentNode {
		return Array.isArray(node.children);
	}

	function createTextNode(value: string): MarkdownNode {
		return { type: "text", value };
	}

	function createLinkNode(label: string, href: string): MarkdownNode {
		return {
			type: "link",
			url: href,
			title: null,
			children: [createTextNode(label)],
		};
	}

	function createInlineCodeNode(value: string): MarkdownNode {
		return { type: "inlineCode", value: normalizeLocalFileHref(value) };
	}

	function getFileDisplayName(fileReference: string): string {
		const match = FILE_REFERENCE_WITH_LOCATION_PATTERN.exec(fileReference);
		if (!match?.groups?.path || !match.groups.line) {
			return fileReference.split("/").pop() ?? fileReference;
		}

		const { path, line, column } = match.groups;
		const fileName = path.split("/").pop() ?? path;
		return column ? `${fileName}:${line}:${column}` : `${fileName}:${line}`;
	}

	function normalizeLocalFileHref(href: string): string {
		const [path, fragment] = href.split("#", 2);
		const lineMatch = fragment?.match(/^L(\d+)$/u);
		if (path !== undefined && lineMatch?.[1] !== undefined) {
			return `${path}:${lineMatch[1]}`;
		}
		return href;
	}

	function isLocalFileReference(href: string): boolean {
		if (isExternalUrl(href) || href.startsWith("#") || href.startsWith("mailto:")) {
			return false;
		}

		return KNOWN_FILE_EXTENSION_PATTERN.test(normalizeLocalFileHref(href));
	}

	function collectInlineReferenceMatches(text: string): InlineReferenceMatch[] {
		const matches: InlineReferenceMatch[] = [];

		GITHUB_URL_PATTERN.lastIndex = 0;
		let githubUrlMatch: RegExpExecArray | null;
		while ((githubUrlMatch = GITHUB_URL_PATTERN.exec(text)) !== null) {
			const [full, owner, repo, refType, number] = githubUrlMatch;
			const label = `${owner}/${repo}#${number}`;
			const route = refType === "pull" ? "pull" : "issues";
			matches.push({
				index: githubUrlMatch.index,
				endIndex: githubUrlMatch.index + full.length,
				label,
				href: `https://github.com/${owner}/${repo}/${route}/${number}`,
			});
		}

		GITHUB_PR_SHORTHAND_PATTERN.lastIndex = 0;
		let githubShorthandMatch: RegExpExecArray | null;
		while ((githubShorthandMatch = GITHUB_PR_SHORTHAND_PATTERN.exec(text)) !== null) {
			const [full, owner, repo, number] = githubShorthandMatch;
			matches.push({
				index: githubShorthandMatch.index,
				endIndex: githubShorthandMatch.index + full.length,
				label: full,
				href: `https://github.com/${owner}/${repo}/pull/${number}`,
			});
		}

		FILE_PATH_IN_TEXT_PATTERN.lastIndex = 0;
		let filePathMatch: RegExpExecArray | null;
		while ((filePathMatch = FILE_PATH_IN_TEXT_PATTERN.exec(text)) !== null) {
			const [full] = filePathMatch;
			matches.push({
				index: filePathMatch.index,
				endIndex: filePathMatch.index + full.length,
				label: getFileDisplayName(full),
				href: full,
			});
		}

		return matches
			.sort((a, b) => a.index - b.index)
			.filter((match, index, sortedMatches) => {
				const previous = sortedMatches[index - 1];
				return previous === undefined || match.index >= previous.endIndex;
			});
	}

	function splitTextNodeByInlineReferences(text: string): MarkdownNode[] {
		const matches = collectInlineReferenceMatches(text);
		if (matches.length === 0) {
			return [createTextNode(text)];
		}

		const nodes: MarkdownNode[] = [];
		let lastIndex = 0;
		for (const match of matches) {
			if (match.index > lastIndex) {
				nodes.push(createTextNode(text.slice(lastIndex, match.index)));
			}
			nodes.push(
				isLocalFileReference(match.href)
					? createInlineCodeNode(match.href)
					: createLinkNode(match.label, match.href)
			);
			lastIndex = match.endIndex;
		}

		if (lastIndex < text.length) {
			nodes.push(createTextNode(text.slice(lastIndex)));
		}

		return nodes;
	}

	function transformInlineReferences(node: MarkdownNode): void {
		if (!isMarkdownParentNode(node) || node.type === "link") {
			return;
		}

		const transformedChildren: MarkdownNode[] = [];
		for (const child of node.children) {
			if (child.type === "link" && child.url !== undefined && isLocalFileReference(child.url)) {
				transformedChildren.push(createInlineCodeNode(child.url));
				continue;
			}

			if (child.type === "text" && child.value !== undefined) {
				for (const replacement of splitTextNodeByInlineReferences(child.value)) {
					transformedChildren.push(replacement);
				}
				continue;
			}

			transformInlineReferences(child);
			transformedChildren.push(child);
		}

		node.children = transformedChildren;
	}

	function acepeInlineReferenceRemarkPlugin() {
		return (tree: MarkdownParentNode): void => {
			transformInlineReferences(tree);
		};
	}

	function createTokenRevealAnimation(
		tokenRevealTiming: StreamdownTokenRevealTiming | undefined
	): StreamdownMarkdownAnimation | undefined {
		if (tokenRevealTiming === undefined) {
			return undefined;
		}

		if (tokenRevealTiming.mode === "instant" || tokenRevealTiming.revealCount < 1) {
			return false;
		}

		return {
			animation: "acepeTokenReveal",
			duration: tokenRevealTiming.tokFadeDurMs,
			easing: "cubic-bezier(0.16, 1, 0.3, 1)",
			sep: "word",
			stagger: tokenRevealTiming.tokStepMs,
		};
	}


	function createTokenRevealStyle(
		tokenRevealTiming: StreamdownTokenRevealTiming | undefined
	): string | undefined {
		if (tokenRevealTiming === undefined) {
			return undefined;
		}

		return [
			`--token-reveal-baseline-ms: ${String(tokenRevealTiming.baselineMs)}ms`,
			`--token-reveal-step-ms: ${String(tokenRevealTiming.tokStepMs)}ms`,
			`--token-reveal-fade-ms: ${String(tokenRevealTiming.tokFadeDurMs)}ms`,
		].join("; ");
	}

	function trimTokenRevealAnimationToTail(
		node: HTMLDivElement,
		tokenRevealTiming: StreamdownTokenRevealTiming | undefined
	): void {
		if (
			tokenRevealTiming === undefined ||
			tokenRevealTiming.mode === "instant" ||
			tokenRevealTiming.revealCount < 1
		) {
			return;
		}

		const animatedElements = Array.from(
			node.querySelectorAll("[data-sd-animate]")
		) as HTMLElement[];
		const tailStartIndex = Math.max(0, animatedElements.length - tokenRevealTiming.revealCount);

		for (let index = 0; index < animatedElements.length; index += 1) {
			const animatedElement = animatedElements[index];
			if (animatedElement === undefined) {
				continue;
			}

			if (index < tailStartIndex) {
				animatedElement.removeAttribute("data-sd-animate");
				animatedElement.removeAttribute("data-acepe-token-reveal-tail");
				animatedElement.style.setProperty("--sd-duration", "0ms");
				animatedElement.style.setProperty("--sd-delay", "0ms");
				continue;
			}

			animatedElement.setAttribute("data-acepe-token-reveal-tail", "true");
		}
	}

	function scheduleTokenRevealTailTrim(
		node: HTMLDivElement,
		getTokenRevealTiming: () => StreamdownTokenRevealTiming | undefined
	): void {
		const trimLatestTokenRevealTail = () => {
			trimTokenRevealAnimationToTail(node, getTokenRevealTiming());
		};

		queueMicrotask(trimLatestTokenRevealTail);
		window.setTimeout(trimLatestTokenRevealTail, 0);
		window.setTimeout(trimLatestTokenRevealTail, 16);
	}

	function createFileChipElement(
		fileReference: string,
		onFilePathClick: (filePath: string) => void
	) {
		const normalizedFileReference = normalizeLocalFileHref(fileReference);
		const label = getFileDisplayName(normalizedFileReference);
		return createElement(
			"button",
			{
				className: buildChipShellClassName({
					density: "badge",
					interactive: true,
					className: "file-path-badge",
				}),
				type: "button",
				title: normalizedFileReference,
				"data-file-path": normalizedFileReference,
				onClick: (event: ReactMouseEvent<HTMLButtonElement>) => {
					event.preventDefault();
					event.stopPropagation();
					onFilePathClick(normalizedFileReference);
				},
			},
			createElement("img", {
				src: getFileIconSrc(normalizedFileReference),
				alt: "",
				className: "file-icon h-3.5 w-3.5 shrink-0 object-contain",
				"aria-hidden": "true",
				onError: (event: SyntheticEvent<HTMLImageElement>) => {
					event.currentTarget.src = getFallbackIconSrc();
				},
			}),
			createElement(
				"span",
				{
					className: "file-name min-w-0 truncate font-mono text-[0.6875rem] leading-none",
				},
				label
			)
		);
	}

	function createCopyIconElement() {
		return createElement(
			"svg",
			{
				className: "icon-copy",
				xmlns: "http://www.w3.org/2000/svg",
				width: "14",
				height: "14",
				viewBox: "0 0 256 256",
				fill: "currentColor",
				"aria-hidden": "true",
			},
			createElement("path", {
				d: "M216,32H88a8,8,0,0,0-8,8V80H40a8,8,0,0,0-8,8V216a8,8,0,0,0,8,8H168a8,8,0,0,0,8-8V176h40a8,8,0,0,0,8-8V40A8,8,0,0,0,216,32Zm-8,128H176V88a8,8,0,0,0-8-8H96V48H208Z",
			})
		);
	}

	function createCheckIconElement() {
		return createElement(
			"svg",
			{
				className: "icon-check",
				xmlns: "http://www.w3.org/2000/svg",
				width: "14",
				height: "14",
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "2",
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": "true",
			},
			createElement("path", { d: "M5 12l5 5l10 -10" })
		);
	}

	function AcepeCodeCopyButton({ code }: { readonly code: string }) {
		const [copied, setCopied] = useState(false);
		const copiedTimeoutId = useRef<number | null>(null);

		useEffect(() => {
			return () => {
				if (copiedTimeoutId.current !== null) {
					window.clearTimeout(copiedTimeoutId.current);
				}
			};
		}, []);

		function handleClick(event: ReactMouseEvent<HTMLButtonElement>): void {
			event.preventDefault();
			event.stopPropagation();

			if (!code.trim()) {
				console.warn("Cannot copy empty code block");
				return;
			}

			void writeClipboardText(code).match(
				() => {
					setCopied(true);
					if (copiedTimeoutId.current !== null) {
						window.clearTimeout(copiedTimeoutId.current);
					}
					copiedTimeoutId.current = window.setTimeout(() => {
						setCopied(false);
						copiedTimeoutId.current = null;
					}, 1500);
				},
				(error) => {
					console.error("Failed to copy code block", error);
				}
			);
		}

		return createElement(
			"button",
			{
				"aria-label": copied ? "Copied code" : "Copy code",
				className: cn(ACEPE_CODE_COPY_BUTTON_CLASS, copied && "text-success"),
				"data-acepe-code-copy-button": "true",
				"data-copy-state": copied ? "copied" : "idle",
				onClick: handleClick,
				title: copied ? "Copied!" : "Copy code",
				type: "button",
			},
			copied ? createCheckIconElement() : createCopyIconElement()
		);
	}

	function AcepeCodeBlock({
		className,
		code,
		isIncomplete,
		language,
		lineNumbers,
		startLine,
		children,
	}: {
		readonly className: string | undefined;
		readonly code: string;
		readonly isIncomplete: boolean;
		readonly language: string;
		readonly lineNumbers: boolean;
		readonly startLine: number | undefined;
		readonly children?: ReactNode;
	}) {
		const normalizedLanguage = normalizeCodeLanguage(language);
		const languageLabel = getCodeLanguageLabel(normalizedLanguage);
		const languageIconSrc = getCodeLanguageIconSrc(normalizedLanguage);
		const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);

		useEffect(() => {
			let cancelled = false;
			setHighlightedHtml(null);

			if (isIncomplete) {
				return () => {
					cancelled = true;
				};
			}

			void ResultAsync.fromPromise(
				import("shiki"),
				(error) => new Error(`Failed to load code highlighter: ${String(error)}`)
			)
				.andThen((shiki) =>
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
							(error) => new Error(`Failed to highlight code block: ${String(error)}`)
						)
					)
				)
				.match(
					(html) => {
						if (!cancelled) {
							setHighlightedHtml(html);
						}
					},
					(error) => {
						console.error(error.message);
					}
				);

			return () => {
				cancelled = true;
			};
		}, [code, isIncomplete, normalizedLanguage]);

		const codeStyle =
			lineNumbers && startLine !== undefined
				? { counterReset: `line ${startLine - 1}` }
				: lineNumbers
					? { counterReset: "line" }
					: undefined;

		return createElement(
			"div",
			{
				className: cn(STREAMDOWN_CODE_BLOCK_CLASS, className),
				"data-language": normalizedLanguage,
				"data-streamdown": "code-block",
			},
			createElement(
				"div",
				{
					role: "group",
					className: STREAMDOWN_CODE_BLOCK_HEADER_CLASS,
					"data-acepe-code-language": normalizedLanguage || "text",
					"data-streamdown": "code-block-header",
				},
				createElement(
					"div",
					{ className: STREAMDOWN_CODE_BLOCK_HEADER_LEFT_CLASS },
					createElement(
						"div",
						{
							className: STREAMDOWN_CODE_BLOCK_HEADER_INNER_CLASS,
							title: languageLabel,
						},
						createElement("img", {
							alt: "",
							className: ACEPE_CODE_LANGUAGE_ICON_CLASS,
							src: languageIconSrc,
						}),
						createElement(
							"span",
							{ className: ACEPE_CODE_LANGUAGE_LABEL_CLASS },
							languageLabel
						)
					)
				),
				createElement(
					"div",
					{
						className: STREAMDOWN_CODE_BLOCK_HEADER_ACTIONS_CLASS,
						"data-streamdown": "code-block-actions",
					},
					children
				)
			),
			createElement(
				"div",
				{
					className: cn(
						STREAMDOWN_CODE_BLOCK_BODY_CLASS,
						`language-${normalizedLanguage || "text"}`
					),
					"data-streamdown": "code-block-body",
				},
				highlightedHtml
					? createElement("div", {
							"data-acepe-code-highlighted": "true",
							"data-acepe-code-line-numbers": lineNumbers ? "true" : "false",
							dangerouslySetInnerHTML: { __html: highlightedHtml },
							style: codeStyle,
						})
					: createElement(
							"pre",
							{
								className: cn(
									STREAMDOWN_CODE_BLOCK_BODY_PRE_CLASS,
									`language-${normalizedLanguage || "text"}`
								),
							},
							createElement("code", { style: codeStyle }, code)
						)
			)
		);
	}

	function MarkdownCode(props: CodeProps) {
		const isIncomplete = useIsCodeFenceIncomplete();
		const className = typeof props.className === "string" ? props.className : undefined;
		if (!isCodeBlock(props)) {
			return createElement("code", { className }, props.children);
		}

		const code = reactNodeToText(props.children);
		const meta = extractCodeMetaString(props);
		return createElement(
			AcepeCodeBlock,
			{
				className,
				code,
				isIncomplete,
				language: extractCodeLanguage(className),
				lineNumbers: !CODE_NO_LINE_NUMBERS_META_PATTERN.test(meta ?? ""),
				startLine: extractCodeStartLine(meta),
			},
			createElement(AcepeCodeCopyButton, { code })
		);
	}

	function MarkdownTable(props: TableProps) {
		return createElement(
			"div",
			{ className: "acepe-table-wrapper" },
			createElement(
				"table",
				{
					className: props.className,
					style: props.style,
					title: props.title,
				},
				props.children
			)
		);
	}

	function isGitHubUrl(href: string): boolean {
		return /^https:\/\/github\.com\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\/(?:pull|issues?)\/\d+$/u.test(
			href
		);
	}

	function createGitHubChipElement(
		href: string,
		label: string,
		onExternalLinkClick: ((url: string) => void) | undefined
	) {
		return createElement(
			"a",
			{
				className: buildChipShellClassName({
					density: "badge",
					interactive: true,
					className: "github-badge",
				}),
				href,
				rel: "noopener noreferrer",
				target: "_blank",
				title: label,
				onClick: (event: ReactMouseEvent<HTMLAnchorElement>) => {
					if (onExternalLinkClick === undefined) {
						return;
					}

					event.preventDefault();
					event.stopPropagation();
					onExternalLinkClick(href);
				},
			},
			createElement(
				"span",
				{
					className: "min-w-0 truncate font-mono text-[0.6875rem] leading-none",
				},
				label
			)
		);
	}

	function createComponents(
		onExternalLinkClick: ((url: string) => void) | undefined,
		onFilePathClick: ((filePath: string) => void) | undefined
	): Components {
		return {
			code: MarkdownCode,
			table: MarkdownTable,
			a: (props: AnchorProps) => {
				const href = typeof props.href === "string" ? props.href : undefined;
				const childText = reactNodeToText(props.children);
				if (
					onFilePathClick !== undefined &&
					href !== undefined &&
					isLocalFileReference(href)
				) {
					return createFileChipElement(href, onFilePathClick);
				}

				if (href !== undefined && childText.length > 0 && isGitHubUrl(href)) {
					return createGitHubChipElement(href, childText, onExternalLinkClick);
				}

				return createElement(
					"a",
					{
						className: props.className,
						href,
						rel: props.rel,
						target: props.target,
						title: props.title,
						onClick: (event) => {
							if (href === undefined || !isExternalUrl(href)) {
								return;
							}

							event.preventDefault();
							event.stopPropagation();
							onExternalLinkClick?.(href);
						},
					},
					props.children
				);
			},
			inlineCode: (props: InlineCodeProps) => {
				const childText = reactNodeToText(props.children);
				if (
					onFilePathClick === undefined ||
					childText.length === 0 ||
					!isLocalFileReference(childText)
				) {
					return createElement("code", { className: props.className }, props.children);
				}

				return createFileChipElement(childText, onFilePathClick);
			},
		};
	}

	function renderStreamdown(
		root: Root,
		node: HTMLDivElement,
		options: StreamdownActionOptions,
		getTokenRevealTiming: () => StreamdownTokenRevealTiming | undefined
	): void {
		root.render(
			createElement(
				Streamdown,
				{
					key: options.animationResetKey,
					mode: options.mode,
					isAnimating: options.isAnimating,
					parseIncompleteMarkdown: options.parseIncompleteMarkdown,
					animated: options.animated,
					remend: options.remend,
					urlTransform: options.urlTransform,
					remarkPlugins: options.remarkPlugins,
					components: createComponents(
						options.onExternalLinkClick,
						options.onFilePathClick
					),
					className: "streamdown-content",
				},
				options.markdown
			)
		);
		scheduleTokenRevealTailTrim(node, getTokenRevealTiming);
	}

	function streamdownMarkdown(
		node: HTMLDivElement,
		options: StreamdownActionOptions
	): {
		update: (nextOptions: StreamdownActionOptions) => void;
		destroy: () => void;
	} {
		const root = createRoot(node);
		let currentTokenRevealTiming = options.tokenRevealTiming;
		const getTokenRevealTiming = () => currentTokenRevealTiming;
		renderStreamdown(root, node, options, getTokenRevealTiming);

		return {
			update(nextOptions: StreamdownActionOptions) {
				currentTokenRevealTiming = nextOptions.tokenRevealTiming;
				renderStreamdown(root, node, nextOptions, getTokenRevealTiming);
			},
			destroy() {
				root.unmount();
			},
		};
	}
</script>

<script lang="ts">
	interface Props {
		markdown: string;
		class?: string;
		mode?: StreamdownMarkdownMode;
		parseIncompleteMarkdown?: boolean;
		animated?: StreamdownMarkdownAnimation;
		tokenRevealTiming?: StreamdownTokenRevealTiming;
		onExternalLinkClick?: (url: string) => void;
		onFilePathClick?: (filePath: string) => void;
	}

	let {
		markdown,
		class: className = "",
		mode = "static",
		parseIncompleteMarkdown,
		animated,
		tokenRevealTiming,
		onExternalLinkClick,
		onFilePathClick,
	}: Props = $props();

	const tokenRevealAnimation = $derived(createTokenRevealAnimation(tokenRevealTiming));
	const tokenRevealStyle = $derived(createTokenRevealStyle(tokenRevealTiming));
	const tokenRevealMode = $derived(tokenRevealTiming?.mode);
	const isTokenRevealAnimating = $derived(
		tokenRevealTiming !== undefined &&
			tokenRevealTiming.mode === "smooth" &&
			tokenRevealTiming.revealCount > 0
	);
	const acepeConfig = $derived(
		createAcepeStreamdownConfig({
			phase: mode === "streaming" ? "streaming" : "settled",
			streamingAnimationMode:
				animated === false || tokenRevealTiming?.mode === "instant" ? "instant" : "smooth",
		})
	);

	const streamdownOptions = $derived({
		markdown,
		mode: acepeConfig.mode,
		isAnimating: acepeConfig.mode === "streaming" || isTokenRevealAnimating,
		parseIncompleteMarkdown:
			parseIncompleteMarkdown ?? acepeConfig.parseIncompleteMarkdown,
		animated: tokenRevealAnimation ?? animated ?? acepeConfig.animated,
		tokenRevealTiming,
		remend: acepeConfig.remend,
		urlTransform: acepeConfig.urlTransform,
		remarkPlugins: ACEPE_REMARK_PLUGINS,
		animationResetKey: createTokenRevealAnimationResetKey(tokenRevealTiming),
		onExternalLinkClick,
		onFilePathClick,
	});
</script>

<div
	class="markdown-content {className}"
	style={tokenRevealStyle}
	data-token-reveal-mode={tokenRevealMode}
	use:streamdownMarkdown={streamdownOptions}
></div>
