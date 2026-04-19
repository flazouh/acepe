<script lang="ts">
import { AppSidebarFooter } from "@acepe/ui/app-layout";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ResultAsync } from "neverthrow";

let appVersion = $state<string | null>(null);

void ResultAsync.fromPromise(getVersion(), (error) => error).match(
(version) => {
appVersion = version;
},
() => {
appVersion = null;
}
);

function handleLinkClick(url: string) {
void ResultAsync.fromPromise(openUrl(url), (error) => error).match(
() => undefined,
() => undefined
);
}
</script>

<AppSidebarFooter
githubUrl="https://github.com/flazouh/acepe"
xUrl="https://x.com/acepedotdev"
discordUrl="https://discord.gg/5YhW7T7qhS"
version={appVersion}
onLinkClick={handleLinkClick}
/>
