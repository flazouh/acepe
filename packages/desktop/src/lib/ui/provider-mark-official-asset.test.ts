import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const providerMarkPath = resolve(
	__dirname,
	"../../../../ui/src/components/provider-mark/provider-mark.svelte"
);
const providerMarkSource = readFileSync(providerMarkPath, "utf8");

describe("provider mark official asset", () => {
	it("uses a vendored official Anthropic asset instead of the temporary inline mark", () => {
		expect(providerMarkSource).toContain(
			'import anthropicLogo from "./anthropic-official.png?url";'
		);
		expect(providerMarkSource).toContain('src="/svgs/agents/codex/codex-icon-light.svg"');
		expect(providerMarkSource).toContain('src="/svgs/agents/codex/codex-icon-dark.svg"');
		expect(providerMarkSource).toContain(
			'<img src={anthropicLogo} alt="" class="size-full object-contain dark:invert" />'
		);
	});

	it("keeps provider marks muted until hover reveals their full treatment", () => {
		expect(providerMarkSource).toContain("grayscale");
		expect(providerMarkSource).toContain("opacity-50");
		expect(providerMarkSource).toContain("text-[#4285f4]");
		expect(providerMarkSource).toContain("group-hover/item:grayscale-0");
		expect(providerMarkSource).toContain("group-hover/item:opacity-100");
		expect(providerMarkSource).toContain("group-hover:grayscale-0");
		expect(providerMarkSource).toContain("group-hover:opacity-100");
		expect(providerMarkSource).toContain("group-hover/provider-trigger:grayscale-0");
		expect(providerMarkSource).toContain("group-hover/provider-trigger:opacity-100");
	});
});
