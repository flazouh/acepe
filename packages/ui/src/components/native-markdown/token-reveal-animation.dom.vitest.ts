/**
 * Regression coverage for the token-reveal "dormant animation" bug class.
 *
 * The streaming per-word fade has gone dormant multiple times via distinct
 * mechanisms that all degrade silently to "words pop in instantly" — a
 * plausible-looking failure that no prior test caught. Root causes seen so
 * far:
 *   - the CSS rule that binds `[data-sd-animate]` to the keyframe stopped
 *     setting `animation-name`, so the browser never started the animation
 *     even though every other animation-* property (duration/delay) was
 *     still being computed correctly (see markdown-prose.css).
 *   - upstream timing went missing, so every revealed word got the same
 *     (zero) `animation-delay`, making the whole accumulated message
 *     re-fade in lockstep on every delta instead of just the new tail.
 *
 * happy-dom's `getComputedStyle` does not run a real CSS cascade (it never
 * even loads imported stylesheets into `document.styleSheets` for a
 * component render), so a naive computed-style assertion would pass whether
 * or not the CSS is actually wired up — exactly how this bug shipped
 * unnoticed. This test instead loads the REAL production stylesheet from
 * disk into `document.styleSheets` and inspects the matching CSSOM rule's
 * own declared properties directly, which happy-dom parses correctly. That
 * makes the assertion fail if `markdown-prose.css` ever again drops the
 * `animation-name` binding, whatever the mechanism.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import NativeMarkdown from "./native-markdown.svelte";
import type { NativeMarkdownTokenRevealTiming } from "./types.js";

vi.mock("svelte", async () => {
	const { createRequire } = await import("node:module");
	const { dirname: nodeDirname, join: nodeJoin } = await import("node:path");
	const require = createRequire(import.meta.url);
	const svelteClientPath = nodeJoin(
		nodeDirname(require.resolve("svelte/package.json")),
		"src/index-client.js"
	);

	return import(/* @vite-ignore */ svelteClientPath);
});

const here = dirname(fileURLToPath(import.meta.url));
const markdownProseCssPath = join(here, "../markdown/markdown-prose.css");
const markdownProseCss = readFileSync(markdownProseCssPath, "utf-8");

let injectedStyle: HTMLStyleElement | null = null;

beforeEach(() => {
	injectedStyle = document.createElement("style");
	injectedStyle.textContent = markdownProseCss;
	document.head.appendChild(injectedStyle);
});

afterEach(() => {
	cleanup();
	injectedStyle?.remove();
	injectedStyle = null;
});

function timingFor(markdown: string, revealCount: number): NativeMarkdownTokenRevealTiming {
	return {
		revealCount,
		revealedCharCount: markdown.length,
		baselineMs: -96,
		tokStepMs: 48,
		tokFadeDurMs: 630,
		mode: "smooth",
	};
}

function animatedSpans(container: HTMLElement): HTMLElement[] {
	return Array.from(container.querySelectorAll("[data-sd-animate]"));
}

/** The real CSSOM rule that must bind the fade keyframe to `[data-sd-animate]` while streaming. */
function findTokenRevealCssRule(): CSSStyleRule {
	for (const sheet of Array.from(document.styleSheets)) {
		for (const rule of Array.from(sheet.cssRules) as CSSStyleRule[]) {
			if (
				rule.selectorText?.includes('[data-token-reveal-mode="smooth"]') &&
				rule.selectorText.includes("[data-sd-animate]")
			) {
				return rule;
			}
		}
	}
	throw new Error(
		"No CSS rule found binding [data-token-reveal-mode=\"smooth\"] [data-sd-animate] — " +
			"markdown-prose.css structure changed or the stylesheet failed to load."
	);
}

describe("token reveal animation binding (regression)", () => {
	it("the production CSS rule actually binds animation-name, not just duration/delay", () => {
		// This is the exact assertion that catches the dormancy this bug class
		// keeps producing: a rule can set animation-duration/animation-delay
		// (both present) while never setting animation-name, so the browser
		// never starts the keyframe and words pop in instantly.
		const rule = findTokenRevealCssRule();

		expect(rule.style.animationName).not.toBe("");
		expect(rule.style.animationDuration).not.toBe("");
		expect(rule.style.animationDelay).not.toBe("");
	});

	it("a live streaming span resolves to that bound rule (matches the selector)", async () => {
		const markdown = "Hello streaming world";
		const { container } = render(NativeMarkdown, {
			markdown,
			tokenRevealTiming: timingFor(markdown, 3),
		});

		await waitFor(() => {
			expect(animatedSpans(container).length).toBeGreaterThan(0);
		});

		const span = animatedSpans(container)[0];
		const markdownContent = container.querySelector(".markdown-content");
		expect(markdownContent?.getAttribute("data-token-reveal-mode")).toBe("smooth");
		expect(span.matches('[data-token-reveal-mode="smooth"] [data-sd-animate]')).toBe(true);
	});

	it("keeps [data-sd-animate] on only the newest tail after a second delta, not the whole accumulated body", async () => {
		const firstMarkdown = "alpha beta gamma delta";
		const secondMarkdown = "alpha beta gamma delta epsilon zeta";
		const result = render(NativeMarkdown, {
			markdown: firstMarkdown,
			tokenRevealTiming: timingFor(firstMarkdown, 2),
		});

		await waitFor(() => {
			expect(animatedSpans(result.container).map((el) => el.textContent)).toEqual([
				"gamma",
				"delta",
			]);
		});

		await result.rerender({
			markdown: secondMarkdown,
			tokenRevealTiming: timingFor(secondMarkdown, 2),
		});

		await waitFor(() => {
			expect(animatedSpans(result.container).map((el) => el.textContent)).toEqual([
				"epsilon",
				"zeta",
			]);
		});

		// The whole accumulated body must NOT re-carry the animate marker —
		// this is the "streaming flicker" failure mode: every word re-fading
		// from opacity 0 on every delta instead of only the new tail.
		const allWords = Array.from(result.container.querySelectorAll("[data-markdown-token-word]"));
		expect(allWords.length).toBe(6);
		expect(animatedSpans(result.container).length).toBe(2);
	});

	it("staggers the tail's --sd-delay across words instead of firing them all at once", async () => {
		// The rule's own animation-delay declaration must be driven by the
		// per-word --sd-delay custom property (plus the clock-anchor
		// baseline) — if it were a fixed value instead, every tail word would
		// fire in lockstep regardless of how many words are in the tail. This
		// is the upstream-timing dormancy: the whole accumulated message
		// re-fades together instead of staggering word-by-word.
		const rule = findTokenRevealCssRule();
		expect(rule.style.animationDelay).toContain("--sd-delay");
		expect(rule.style.animationDelay).toContain("--token-reveal-baseline-ms");

		const markdown = "alpha beta gamma delta";
		const { container } = render(NativeMarkdown, {
			markdown,
			tokenRevealTiming: timingFor(markdown, 3),
		});

		await waitFor(() => {
			expect(animatedSpans(container).length).toBe(3);
		});

		const [first, , last] = animatedSpans(container);
		const firstDelay = first.style.getPropertyValue("--sd-delay");
		const lastDelay = last.style.getPropertyValue("--sd-delay");

		expect(firstDelay).not.toBe("");
		expect(lastDelay).not.toBe("");
		expect(firstDelay).not.toBe(lastDelay);
	});
});
