import path from "node:path";
import { fileURLToPath } from "node:url";

import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";

const host = process.env.TAURI_DEV_HOST;
const viteConfigDir = path.dirname(fileURLToPath(import.meta.url));
const uiPackageRoot = path.resolve(viteConfigDir, "../ui");
const uiPackageSrc = path.resolve(uiPackageRoot, "src");
const uiPackageLinkedRoot = path.resolve(viteConfigDir, "node_modules/@acepe/ui");

/**
 * Keep @acepe/ui out of Vite's dep cache and invalidate the module graph when
 * workspace UI sources change (symlinked packages are easy to watch but hard to HMR).
 *
 * @returns {import("vite").Plugin}
 */
function acepeUiPackageDev() {
	return {
		name: "acepe-ui-package-dev",
		configureServer(server) {
			server.watcher.add(uiPackageSrc);

			const invalidateUiFile = (file) => {
				const normalizedFile = path.normalize(file);
				if (!normalizedFile.startsWith(uiPackageSrc)) {
					return;
				}

				let invalidated = false;
				const pathsToCheck = [normalizedFile];

				const relativePath = path.relative(uiPackageSrc, normalizedFile);
				if (relativePath && !relativePath.startsWith("..")) {
					pathsToCheck.push(path.join(uiPackageLinkedRoot, relativePath));
				}

				for (const filePath of pathsToCheck) {
					const modules = server.moduleGraph.getModulesByFile(filePath);
					if (!modules) {
						continue;
					}

					for (const module of modules) {
						server.moduleGraph.invalidateModule(module);
						invalidated = true;
					}
				}

				if (!invalidated) {
					server.ws.send({ type: "full-reload" });
				}
			};

			server.watcher.on("change", invalidateUiFile);
			server.watcher.on("add", invalidateUiFile);
			server.watcher.on("unlink", invalidateUiFile);
		},
	};
}

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
	plugins: [acepeUiPackageDev(), sveltekit(), tailwindcss()],

	resolve: {
		// Resolve @acepe/ui through real paths so file watchers and HMR line up.
		preserveSymlinks: false,
		dedupe: ["@acepe/ui"],
	},

	// Keep workspace UI source out of the dep pre-bundle cache.
	optimizeDeps: {
		exclude: ["@acepe/ui"],
	},

	ssr: {
		noExternal: ["@acepe/ui"],
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
			allow: [uiPackageRoot, uiPackageSrc],
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
