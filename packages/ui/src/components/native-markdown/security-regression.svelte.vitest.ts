import { cleanup, render, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import NativeMarkdown from "./native-markdown.svelte";

vi.mock("svelte", async () => {
	const { createRequire } = await import("node:module");
	const { dirname, join } = await import("node:path");
	const require = createRequire(import.meta.url);
	const svelteClientPath = join(
		dirname(require.resolve("svelte/package.json")),
		"src/index-client.js"
	);

	return import(/* @vite-ignore */ svelteClientPath);
});

afterEach(() => {
	cleanup();
});

describe("NativeMarkdown security regression coverage", () => {
	it("removes script-capable raw HTML from model-authored markdown", async () => {
		const { container } = render(NativeMarkdown, {
			markdown:
				'<script>alert("x")</script><img src="x" onerror="alert(1)"><iframe src="https://example.com"></iframe>',
		});

		await waitFor(() => {
			expect(container.querySelector("script")).toBeNull();
		});
		expect(container.querySelector("iframe")).toBeNull();
		expect(container.innerHTML).not.toContain("onerror");
	});

	it("removes unsafe href protocols from rendered links", async () => {
		const { container } = render(NativeMarkdown, {
			markdown:
				"[bad](javascript:alert(1)) [data](data:text/html,x) [file](file:///etc/passwd) [ok](https://example.com)",
		});

		await waitFor(() => {
			expect(container.textContent).toContain("ok");
		});

		expect(container.innerHTML).not.toContain("javascript:alert(1)");
		expect(container.innerHTML).not.toContain("data:text/html,x");
		expect(container.innerHTML).not.toContain("file:///etc/passwd");
	});
});
