import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	forgetProjectIconPreview,
	type ImageLoader,
	projectIconPreview,
	resetProjectIconPreviews,
} from "../project-icon-preview.svelte.js";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
	resetProjectIconPreviews();
});

describe("projectIconPreview", () => {
	it("answers null and starts the read on the first call", async () => {
		const loader = vi.fn<ImageLoader>(async () => "data:image/png;base64,AAA");
		expect(projectIconPreview("/repo/logo.png", loader)).toBeNull();
		await settle();
		expect(loader).toHaveBeenCalledTimes(1);
		expect(projectIconPreview("/repo/logo.png", loader)).toBe("data:image/png;base64,AAA");
	});

	it("asks once for a path even when many badges request it at once", async () => {
		const loader = vi.fn<ImageLoader>(async () => "data:image/png;base64,AAA");
		projectIconPreview("/repo/logo.png", loader);
		projectIconPreview("/repo/logo.png", loader);
		projectIconPreview("/repo/logo.png", loader);
		await settle();
		expect(loader).toHaveBeenCalledTimes(1);
	});

	it("remembers a failure, so a broken path is not retried on every render", async () => {
		const loader = vi.fn<ImageLoader>(async () => null);
		projectIconPreview("/repo/gone.png", loader);
		await settle();
		expect(projectIconPreview("/repo/gone.png", loader)).toBeNull();
		expect(projectIconPreview("/repo/gone.png", loader)).toBeNull();
		expect(loader).toHaveBeenCalledTimes(1);
	});

	it("keeps paths apart", async () => {
		const loader = vi.fn<ImageLoader>(async (path) => `data:${path}`);
		projectIconPreview("/repo/a.png", loader);
		projectIconPreview("/repo/b.png", loader);
		await settle();
		expect(projectIconPreview("/repo/a.png", loader)).toBe("data:/repo/a.png");
		expect(projectIconPreview("/repo/b.png", loader)).toBe("data:/repo/b.png");
	});

	it("never reads for an absent path", async () => {
		const loader = vi.fn<ImageLoader>(async () => "data:x");
		expect(projectIconPreview(null, loader)).toBeNull();
		expect(projectIconPreview(undefined, loader)).toBeNull();
		expect(projectIconPreview("", loader)).toBeNull();
		await settle();
		expect(loader).not.toHaveBeenCalled();
	});

	it("reads again after the path is forgotten", async () => {
		const loader = vi.fn<ImageLoader>(async () => "data:image/png;base64,AAA");
		projectIconPreview("/repo/logo.png", loader);
		await settle();
		forgetProjectIconPreview("/repo/logo.png");
		projectIconPreview("/repo/logo.png", loader);
		await settle();
		expect(loader).toHaveBeenCalledTimes(2);
	});
});
