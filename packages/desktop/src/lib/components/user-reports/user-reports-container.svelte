<script lang="ts">
import { createApiClient } from "@acepe/api";
import { UserReportsModal } from "@acepe/ui/user-reports";

interface Props {
	open: boolean;
	onClose: () => void;
}

let { open, onClose }: Props = $props();

// TODO: Make configurable via env and add auth token from keychain
const API_BASE_URL = import.meta.env.VITE_REPORTS_API_URL ?? "https://acepe.dev";

const apiClient = createApiClient(API_BASE_URL, async () => {
	// TODO: Read auth token from Tauri keychain
	return null;
});
</script>

<UserReportsModal {open} {apiClient} {onClose} />
