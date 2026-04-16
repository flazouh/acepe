// @ts-expect-error - Bun types may not be available in all environments
import { beforeEach } from "bun:test";
import { readFileSync } from "node:fs";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { plugin } from "bun";
import { compile, compileModule } from "svelte/compiler";

type HappyDomGlobalState = typeof globalThis & {
	__acepeHappyDomRegistered__?: boolean;
};

const happyDomGlobalState = globalThis as HappyDomGlobalState;

beforeEach(async () => {
	if (happyDomGlobalState.__acepeHappyDomRegistered__) {
		await GlobalRegistrator.unregister();
	}

	await GlobalRegistrator.register({ url: "http://localhost/" });
	happyDomGlobalState.__acepeHappyDomRegistered__ = true;
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

		// Handle .svelte.ts/.svelte.js files (TypeScript/JS modules with runes)
		// Strip TypeScript first (acorn can't parse TS), then compile runes.
		const transpiler = new Bun.Transpiler({ loader: "ts", target: "bun" });
		builder.onLoad({ filter: /\.svelte\.[tj]s$/ }, ({ path }) => {
			const source = readFileSync(path, "utf-8");
			const jsSource = path.endsWith(".ts") ? transpiler.transformSync(source) : source;
			const result = compileModule(jsSource, {
				filename: path,
				generate: "client",
				dev: false,
			});
			return {
				contents: result.js.code,
				loader: "js",
			};
		});
	},
});
