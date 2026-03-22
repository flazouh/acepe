<script lang="ts">
import type { ChangelogEntry } from "$lib/changelog/index.js";
import type { Theme } from "$lib/components/theme/context.svelte.js";

import { setTheme } from "$lib/components/theme/context.svelte.js";

import ChangelogModal from "./changelog-modal.svelte";

interface Props {
	entries: ChangelogEntry[];
	onDismiss: () => void;
	theme: Exclude<Theme, "system">;
}

let { entries, onDismiss, theme }: Props = $props();

setTheme({
	theme: () => theme,
	setTheme: () => {},
});
</script>

<ChangelogModal {entries} {onDismiss} />
