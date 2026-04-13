import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";

const host = process.env.TAURI_DEV_HOST;
const ignoredDevWatchPaths = [
	"**/src-tauri/**",
	"**/__tests__/**",
	"**/*.test.{js,ts}",
	"**/*.spec.{js,ts}",
	"**/*.vitest.{js,ts}",
	"**/.svelte-kit/**",
	"**/build/**",
	"**/dist/**",
	"**/coverage/**",
];

// https://vite.dev/config/
export default defineConfig({
	build: {
		sourcemap: "hidden",
	},
	worker: {
		format: "es",
	},
	plugins: [
		sveltekit(),
		tailwindcss(),
	],

	// Pre-bundle icon libraries to avoid HMR issues with dynamic imports
	optimizeDeps: {
		include: ["@tabler/icons-svelte", "phosphor-svelte"],
	},

	// Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
	//
	// 1. prevent Vite from obscuring rust errors
	clearScreen: false,
	// 2. tauri expects a fixed port, fail if that port is not available
	server: {
		port: 1420,
		strictPort: true,
		host,
		hmr: host
			? {
					protocol: "ws",
					host,
					port: 1421,
				}
			: undefined,
		watch: {
			// 3. ignore backend sources, generated outputs, and test-only files that should never reload the app UI
			ignored: ignoredDevWatchPaths,
		},
		fs: {
			// Allow serving files from src-tauri/packages for tauri-plugin-mcp guest-js
			allow: [".", "../src-tauri/packages"],
		},
	},

	// Vitest configuration for testing Svelte 5 runes
	test: {
		globals: true,
		environment: "happy-dom",
		// Only include .svelte.test.ts and .vitest.ts files (rune tests) - exclude regular Bun tests
		include: ["**/*.svelte.{test,spec}.{js,ts}", "**/*.vitest.{js,ts}"],
		exclude: [
			"**/node_modules/**",
			"**/dist/**",
			"**/build/**",
			"**/.{idea,git,cache,output,temp}/**",
			"**/src-tauri/**",
		],
		// Tell Vitest to use browser entry points when running tests
		// @ts-expect-error
		resolve: process.env.VITEST
			? {
					conditions: ["browser"],
				}
			: undefined,
	},
});
