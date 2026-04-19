<script lang="ts">
import AttachmentChip from "../shared/attachment-chip.svelte";

import type { ParsedAttachment } from "../../utils/attachment-token-parser.js";

interface Props {
	attachment: ParsedAttachment;
}

const { attachment }: Props = $props();
</script>

<AttachmentChip {attachment} />

