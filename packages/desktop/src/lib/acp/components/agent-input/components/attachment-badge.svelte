<script lang="ts">
import AttachmentChip from "../../shared/attachment-chip.svelte";

import type { Attachment } from "../types/attachment.js";

interface Props {
	attachment: Attachment;
	onRemove: () => void;
	truncate?: boolean;
}

const { attachment, onRemove, truncate = true }: Props = $props();
</script>

<AttachmentChip {attachment} {onRemove} {truncate} />

