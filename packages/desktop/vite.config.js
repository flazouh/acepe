import { paraglideVitePlugin } from "@inlang/paraglide-js";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig({
	build: {
		sourcemap: "hidden",
	},
	plugins: [
		sveltekit(),
		tailwindcss(),
		/** @type {any} */ (
			paraglideVitePlugin({
				project: "./project.inlang",
				outdir: "./src/lib/paraglide",
			})
		),
		// Sentry source map upload — only runs during production builds
		...(process.env.SENTRY_AUTH_TOKEN
			? [
					sentryVitePlugin({
						org: process.env.SENTRY_ORG,
						project: process.env.SENTRY_PROJECT,
						authToken: process.env.SENTRY_AUTH_TOKEN,
						sourcemaps: {
							filesToDeleteAfterUpload: ["./build/**/*.map"],
						},
					}),
				]
			: []),
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
			// 3. tell Vite to ignore watching `src-tauri`
			ignored: ["**/src-tauri/**"],
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
