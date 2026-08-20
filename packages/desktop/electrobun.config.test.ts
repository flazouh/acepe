import { expect, test } from "bun:test";
import config from "./electrobun.config.ts";

test("desktop electrobun config copies the svelte bundle into the bun window", () => {
	expect(config.build.copy["build/"]).toBe("views/mainview/");
	expect(config.build.bun.entrypoint).toBe("src/bun/main.ts");
	expect(config.build.mainProcess).toBe("bun");
	expect(config.release.generatePatch).toBe(true);
});
