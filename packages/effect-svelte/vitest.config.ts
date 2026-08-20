import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [svelte()],
	resolve: {
		conditions: ["browser"],
	},
	test: {
		environment: "happy-dom",
		include: ["src/**/*.test.ts"],
		exclude: ["**/node_modules/**"],
	},
});
