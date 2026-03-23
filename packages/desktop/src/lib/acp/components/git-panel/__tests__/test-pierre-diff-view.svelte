<script lang="ts">
import type { FileDiff as FileDiffType } from "../../../types/github-integration.js";

interface Props {
	diff: FileDiffType;
}

let { diff }: Props = $props();
</script>

<div data-testid="pierre-diff-stub">{diff.path}</div>
