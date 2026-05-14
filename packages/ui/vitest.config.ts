import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [svelte()],
	test: {
		environment: "happy-dom",
		globals: true,
		include: ["src/**/*.svelte.vitest.ts"],
		exclude: ["**/node_modules/**", "**/dist/**"],
	},
});
