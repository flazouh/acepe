// @ts-expect-error - Bun types may not be available in all environments

// @ts-expect-error - Bun types may not be available in all environments
import { afterEach, beforeEach } from "bun:test";
import { readFileSync } from "node:fs";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { plugin } from "bun";
import { compile } from "svelte/compiler";

beforeEach(async () => {
	await GlobalRegistrator.register();
});

afterEach(async () => {
	await GlobalRegistrator.unregister();
});

plugin({
	title: "svelte loader",
	setup(builder) {
		// Handle .svelte files (components)
		builder.onLoad({ filter: /\.svelte(\?[^.]+)?$/ }, ({ path }) => {
			const filePath = path.split("?")[0];
			const source = readFileSync(filePath, "utf-8");

			const result = compile(source, {
				filename: filePath,
				generate: "client",
				dev: false,
			});

			return {
				contents: result.js.code,
				loader: "js",
			};
		});

		// Note: .svelte.ts files (TypeScript modules with runes) are not handled here.
		// These files require Vite/SvelteKit's preprocessing pipeline which includes
		// TypeScript compilation and Svelte rune transformation. For testing .svelte.ts
		// files, consider:
		// 1. Testing the business logic through manager classes (recommended)
		// 2. Using integration tests with the full Vite build
		// 3. Extracting testable logic into separate .ts files
	},
});
