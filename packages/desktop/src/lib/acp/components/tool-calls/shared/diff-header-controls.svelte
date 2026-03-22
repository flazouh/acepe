<script lang="ts">
import IconAlignJustified from "@tabler/icons-svelte/icons/align-justified";
import IconColumns from "@tabler/icons-svelte/icons/columns";
import IconMoon from "@tabler/icons-svelte/icons/moon";
import IconSun from "@tabler/icons-svelte/icons/sun";
import { Button } from "$lib/components/ui/button/index.js";
import { IconWrapper } from "$lib/components/ui/icon-wrapper/index.js";

/**
 * Diff view style options.
 */
export type DiffViewStyle = "split" | "unified";

interface DiffHeaderControlsProps {
	diffStyle: DiffViewStyle;
	themeType: "dark" | "light";
	onStyleChange: (style: DiffViewStyle) => void;
	onThemeChange: (themeType: "dark" | "light") => void;
}

let { diffStyle, themeType, onStyleChange, onThemeChange }: DiffHeaderControlsProps = $props();

// Theme-aware colors from app.css
// Values match exactly what's defined in app.css for consistency
// Using $derived to make them reactive to themeType changes
const borderColor = $derived(
	themeType === "dark"
		? "#2a2a2a" // --border from .dark
		: "hsl(43.5 42.5532% 81.5686%)" // --border from :root
);

const backgroundColor = $derived(
	themeType === "dark"
		? "#1a1a1a" // --background from .dark
		: "hsl(40 60% 98.0392%)" // --background from :root
);

const mutedTextColor = $derived(
	themeType === "dark"
		? "#cccccc" // --muted-foreground from .dark
		: "hsl(25 5.2632% 44.7059%)" // --muted-foreground from :root
);

const accentBg = $derived(
	themeType === "dark"
		? "rgba(42, 42, 42, 0.5)" // Based on --accent: #2a2a2a with opacity
		: "rgba(234, 220, 200, 0.3)" // Based on --accent: hsl(34.2857 68.2927% 83.9216%) with opacity
);

const accentText = $derived(
	themeType === "dark"
		? "#ffffff" // --accent-foreground from .dark
		: "hsl(33.3333 5.4545% 32.3529%)" // --accent-foreground from :root
);

const primaryColor = $derived(
	themeType === "dark"
		? "#c1823c" // --primary from .dark
		: "hsl(32 52% 50%)" // --primary from :root
);
</script>

<div class="flex items-center gap-2 ml-auto">
	<!-- Split view button -->
	<Button
		variant="outline"
		size="sm"
		aria-label="Split view"
		aria-pressed={diffStyle === "split"}
		onclick={() => onStyleChange("split")}
		class="group/button h-7 px-2 diff-header-button"
		style="border-color: {borderColor}; background: {diffStyle === 'split'
			? accentBg
			: backgroundColor}; color: {diffStyle === 'split'
			? accentText
			: mutedTextColor}; --primary-color: {primaryColor};"
	>
		<IconWrapper>
			<IconColumns
				class="size-4 transition-colors diff-header-icon"
				style="color: {diffStyle === 'split' ? accentText : mutedTextColor};"
			/>
		</IconWrapper>
	</Button>

	<!-- Unified view button -->
	<Button
		variant="outline"
		size="sm"
		aria-label="Unified view"
		aria-pressed={diffStyle === "unified"}
		onclick={() => onStyleChange("unified")}
		class="group/button h-7 px-2 diff-header-button"
		style="border-color: {borderColor}; background: {diffStyle === 'unified'
			? accentBg
			: backgroundColor}; color: {diffStyle === 'unified'
			? accentText
			: mutedTextColor}; --primary-color: {primaryColor};"
	>
		<IconWrapper>
			<IconAlignJustified
				class="size-4 transition-colors diff-header-icon"
				style="color: {diffStyle === 'unified' ? accentText : mutedTextColor};"
			/>
		</IconWrapper>
	</Button>

	<!-- Theme toggle button -->
	<Button
		variant="outline"
		size="sm"
		aria-label={`Switch to ${themeType === "dark" ? "light" : "dark"} theme`}
		onclick={() => onThemeChange(themeType === "dark" ? "light" : "dark")}
		class="group/button h-7 px-2 diff-header-button"
		style="border-color: {borderColor}; background: {backgroundColor}; color: {mutedTextColor}; --primary-color: {primaryColor};"
	>
		<IconWrapper>
			{#if themeType === "dark"}
				<IconSun
					class="size-4 transition-colors diff-header-icon"
					style="color: {mutedTextColor};"
				/>
			{:else}
				<IconMoon
					class="size-4 transition-colors diff-header-icon"
					style="color: {mutedTextColor};"
				/>
			{/if}
		</IconWrapper>
	</Button>
</div>

<style>
	:global(.diff-header-button:hover .diff-header-icon) {
		color: var(--primary-color) !important;
	}
</style>
