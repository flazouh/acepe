//! Automatic Claude Code CLI download and management
//!
//! This module provides functionality to automatically download and manage
//! the Claude Code CLI binary, similar to Python SDK's bundling approach.
//!
//! # Download Strategy
//!
//! 1. First, check Acepe's managed Claude CLI cache
//! 2. If not cached, download from official source into that managed cache
//!
//! # Cache Location
//!
//! - Unix: `~/.cache/cc-sdk/cli/`
//! - macOS: `~/Library/Caches/cc-sdk/cli/`
//! - Windows: `%LOCALAPPDATA%\cc-sdk\cli\`
//!
//! # Feature Flag
//!
//! The download functionality requires the `auto-download` feature (enabled by default).
//! To disable, use `default-features = false` in your Cargo.toml.

use super::errors::{Result, SdkError};
use crate::cc_sdk::transport::subprocess::SemVer;
use std::path::{Path, PathBuf};
#[allow(unused_imports)]
use tracing::{debug, info, warn};

/// Minimum supported CLI version (the floor). Standalone — decoupled from any
/// pinned version. Acepe always provisions its own managed Claude CLI and keeps it
/// updated to the latest published release at or above this floor; there is no
/// upper ceiling (see docs/plans/2026-06-23-002-...). The managed binary is
/// deliberately separate from any Claude the user may have installed.
pub const MIN_CLI_VERSION: &str = "2.1.0";

const CLAUDE_CODE_NPM_PACKAGE: &str = "@anthropic-ai/claude-code";

/// npm dist-tags endpoint — returns a small JSON object like `{"latest":"2.1.185",...}`
/// without fetching the full (multi-MB) packument.
const CLAUDE_CODE_DIST_TAGS_URL: &str =
    "https://registry.npmjs.org/-/package/@anthropic-ai/claude-code/dist-tags";

const LATEST_VERSION_PROBE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

type DownloadProgressCallback = Box<dyn Fn(u64, Option<u64>) + Send + Sync>;

/// Get the cache directory for the SDK
pub fn get_cache_dir() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        dirs::home_dir().map(|h| h.join("Library/Caches/cc-sdk/cli"))
    }
    #[cfg(target_os = "windows")]
    {
        dirs::cache_dir().map(|c| c.join("cc-sdk").join("cli"))
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        dirs::cache_dir().map(|c| c.join("cc-sdk").join("cli"))
    }
}

/// Get the path to the cached CLI binary
pub fn get_cached_cli_path() -> Option<PathBuf> {
    let cache_dir = get_cache_dir()?;
    let cli_name = if cfg!(windows) {
        "claude.exe"
    } else {
        "claude"
    };
    Some(cache_dir.join(cli_name))
}

/// Check if the cached CLI exists and is executable
#[allow(dead_code)]
pub fn is_cli_cached() -> bool {
    if let Some(path) = get_cached_cli_path() {
        if path.exists() && path.is_file() {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if let Ok(metadata) = path.metadata() {
                    return metadata.permissions().mode() & 0o111 != 0;
                }
            }
            #[cfg(not(unix))]
            {
                return true;
            }
        }
    }
    false
}

/// Download the Claude Code CLI to the cache directory
///
/// # Arguments
///
/// * `version` - Exact version to download, for example "2.1.0"
/// * `on_progress` - Optional callback for download progress (bytes_downloaded, total_bytes)
///
/// # Returns
///
/// Path to the downloaded CLI binary
///
/// # Feature Flag
///
/// This function requires the `auto-download` feature to be enabled.
/// When disabled, it returns an error directing users to install manually.
#[cfg(feature = "auto-download")]
pub async fn download_cli(
    version: Option<&str>,
    on_progress: Option<DownloadProgressCallback>,
) -> Result<PathBuf> {
    // No version given → resolve the latest published release (always-latest policy).
    let version = match version {
        Some(version) => version.to_string(),
        None => {
            let latest = resolve_latest_cli_version().await?;
            format!("{}.{}.{}", latest.major, latest.minor, latest.patch)
        }
    };
    info!("Downloading Claude Code CLI version: {}", version);

    let cache_dir = get_cache_dir().ok_or_else(|| {
        SdkError::ConfigError("Cannot determine cache directory for CLI download".to_string())
    })?;

    // Create cache directory if it doesn't exist
    std::fs::create_dir_all(&cache_dir)
        .map_err(|e| SdkError::ConfigError(format!("Failed to create cache directory: {}", e)))?;

    let cli_path = get_cached_cli_path()
        .ok_or_else(|| SdkError::ConfigError("Cannot determine CLI path".to_string()))?;

    // Determine platform-specific download URL and installation method
    let install_result = install_cli_for_platform(&version, &cli_path, on_progress).await?;

    info!("Claude Code CLI installed to: {}", install_result.display());
    Ok(install_result)
}

/// Resolve the latest published Claude CLI version from the npm registry dist-tags.
///
/// Returns `Err` on network/parse failure, or when `latest` is not a clean 3-part
/// release version (e.g. a prerelease). Callers treat any `Err` as "skip the update"
/// and keep the existing cached binary — this probe never blocks or panics.
async fn resolve_latest_cli_version() -> Result<SemVer> {
    let client = reqwest::Client::builder()
        .timeout(LATEST_VERSION_PROBE_TIMEOUT)
        .build()
        .map_err(|e| {
            SdkError::ConfigError(format!(
                "Failed to build HTTP client for Claude CLI version probe: {e}"
            ))
        })?;

    let dist_tags: serde_json::Value = client
        .get(CLAUDE_CODE_DIST_TAGS_URL)
        .send()
        .await
        .map_err(|e| {
            SdkError::ConfigError(format!("Failed to query npm dist-tags for Claude CLI: {e}"))
        })?
        .error_for_status()
        .map_err(|e| {
            SdkError::ConfigError(format!("npm dist-tags request for Claude CLI failed: {e}"))
        })?
        .json()
        .await
        .map_err(|e| {
            SdkError::ConfigError(format!("Failed to parse npm dist-tags for Claude CLI: {e}"))
        })?;

    latest_from_dist_tags(&dist_tags)
}

/// Extract and validate the `latest` release version from a parsed npm dist-tags
/// payload. Pure (no I/O) so it can be unit-tested with fixture JSON.
fn latest_from_dist_tags(dist_tags: &serde_json::Value) -> Result<SemVer> {
    let latest = dist_tags
        .get("latest")
        .and_then(|value| value.as_str())
        .ok_or_else(|| {
            SdkError::ConfigError(
                "npm dist-tags response missing `latest` for Claude CLI".to_string(),
            )
        })?;

    parse_exact_release(latest).ok_or_else(|| {
        SdkError::ConfigError(format!(
            "npm `latest` Claude CLI version `{latest}` is not a clean 3-part release; skipping update"
        ))
    })
}

/// Parse a strictly-exact `x.y.z` release version. `SemVer::parse` is lenient (it
/// silently drops prerelease/build suffixes), so gate on `is_exact_semver` first —
/// otherwise a prerelease `latest` would parse here but be rejected later by
/// `npm_package_for_version`, breaking the install path.
fn parse_exact_release(version: &str) -> Option<SemVer> {
    if is_exact_semver(version) {
        SemVer::parse(version)
    } else {
        None
    }
}

/// Build the exact npm package spec to install. Requires an exact `x.y.z` version
/// (no ranges or tags). Package integrity is verified by npm against the registry's
/// metadata over HTTPS during install — Acepe no longer pins a per-version hash
/// (always-latest has no pre-vetted hash to compare against).
fn npm_package_for_version(version: &str) -> Result<String> {
    if !is_exact_semver(version) {
        return Err(SdkError::ConfigError(format!(
            "Claude CLI auto-download requires an exact semver version, got `{version}`"
        )));
    }

    Ok(format!("{CLAUDE_CODE_NPM_PACKAGE}@{version}"))
}

fn is_exact_semver(version: &str) -> bool {
    let parts = version.split('.').collect::<Vec<_>>();
    parts.len() == 3
        && parts
            .iter()
            .all(|part| !part.is_empty() && part.chars().all(|ch| ch.is_ascii_digit()))
}

/// Stub for download_cli when auto-download feature is disabled
#[cfg(not(feature = "auto-download"))]
pub async fn download_cli(
    _version: Option<&str>,
    _on_progress: Option<DownloadProgressCallback>,
) -> Result<PathBuf> {
    Err(SdkError::ConfigError(
        "Auto-download feature is not enabled. \
        Either enable it with `features = [\"auto-download\"]` in Cargo.toml, \
        or install Claude CLI manually: npm install -g @anthropic-ai/claude-code"
            .to_string(),
    ))
}

/// Process-unique token for scratch paths, so concurrent installs (e.g. the startup
/// update check and a first-use install in client_factory) never collide on a shared
/// temp dir or staging file.
#[cfg(feature = "auto-download")]
fn unique_token() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let counter = COUNTER.fetch_add(1, Ordering::Relaxed);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{}-{}-{}", std::process::id(), nanos, counter)
}

/// Atomically place `source` at `target`. Stages into a temp file in the **same
/// directory** (so the rename stays on one filesystem — no cross-device `EXDEV`),
/// chmods 0755 on unix, then `rename`s over the target. A partial/failed copy can
/// never corrupt the live binary, and the rename gives a fresh inode so a Claude
/// subprocess already running off the old binary is unaffected.
#[cfg(feature = "auto-download")]
fn atomically_install_binary(source: &Path, target: &Path) -> Result<()> {
    let parent = target.parent().ok_or_else(|| {
        SdkError::ConfigError(format!(
            "Managed Claude CLI target has no parent directory: {}",
            target.display()
        ))
    })?;
    std::fs::create_dir_all(parent)
        .map_err(|e| SdkError::ConfigError(format!("Failed to create cache directory: {e}")))?;

    let staging = parent.join(format!("claude.download.{}.tmp", unique_token()));
    let _ = std::fs::remove_file(&staging);

    std::fs::copy(source, &staging).map_err(|e| {
        let _ = std::fs::remove_file(&staging);
        SdkError::ConfigError(format!("Failed to stage CLI in cache: {e}"))
    })?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Err(e) =
            std::fs::set_permissions(&staging, std::fs::Permissions::from_mode(0o755))
        {
            let _ = std::fs::remove_file(&staging);
            return Err(SdkError::ConfigError(format!(
                "Failed to set CLI permissions: {e}"
            )));
        }
    }

    std::fs::rename(&staging, target).map_err(|e| {
        let _ = std::fs::remove_file(&staging);
        SdkError::ConfigError(format!("Failed to finalize CLI in cache: {e}"))
    })?;

    Ok(())
}

/// Relative path inside the installed npm package to the real native binary. The
/// package's `bin` field maps `claude` -> `bin/claude.exe` on every platform (the
/// `.exe` name is used even on macOS/Linux).
#[cfg(feature = "auto-download")]
const CLAUDE_NATIVE_BIN_REL: &str = "bin/claude.exe";

/// Sanity floor for the installed native binary. The real binary is ~200 MB; the
/// package's fallback `bin/claude.exe` (when the platform binary was never fetched)
/// is a ~500-byte error shim. Anything this small means the postinstall did not
/// produce a real binary, so we refuse to install it over a working one.
#[cfg(feature = "auto-download")]
const MIN_NATIVE_BINARY_BYTES: u64 = 1_000_000;

/// Install the managed Claude CLI via npm.
///
/// `@anthropic-ai/claude-code` delivers the real native binary through a postinstall
/// (`install.cjs`) that copies it from a platform-specific optional dependency into
/// `bin/claude.exe`. We keep `--ignore-scripts` so no arbitrary dependency-tree
/// scripts run, then invoke ONLY that trusted package's own installer explicitly —
/// the package's documented manual step. Copying `node_modules/.bin/claude` without
/// this yields a ~500-byte error shim, not a working binary.
#[cfg(feature = "auto-download")]
async fn install_cli_for_platform(
    version: &str,
    target_path: &Path,
    on_progress: Option<DownloadProgressCallback>,
) -> Result<PathBuf> {
    use tokio::process::Command;

    if let Some(ref progress) = on_progress {
        progress(0, None);
    }

    if which::which("npm").is_err() {
        return Err(SdkError::CliNotFound {
            searched_paths: format!(
                "Failed to automatically install Claude Code CLI because npm was not found.\n\
                Install npm, or install the CLI manually:\n\n\
                npm install -g {CLAUDE_CODE_NPM_PACKAGE}@{version}"
            ),
        });
    }

    debug!("Attempting to install Claude CLI {version} via npm...");

    let npm_package = npm_package_for_version(version)?;
    let temp_dir = std::env::temp_dir().join(format!("cc-sdk-npm-install-{}", unique_token()));
    let _ = std::fs::remove_dir_all(&temp_dir);
    std::fs::create_dir_all(&temp_dir)
        .map_err(|e| SdkError::ConfigError(format!("Failed to create temp directory: {e}")))?;

    // 1. Install the package + its platform-native optional dependency. We keep
    //    --ignore-scripts; this leaves bin/claude.exe as a fallback shim that step 2
    //    replaces with the real binary.
    let install = Command::new("npm")
        .args([
            "install",
            "--ignore-scripts",
            "--prefix",
            temp_dir.to_str().unwrap(),
            &npm_package,
        ])
        .output()
        .await
        .map_err(SdkError::ProcessError)?;
    if !install.status.success() {
        let stderr = String::from_utf8_lossy(&install.stderr);
        warn!("Claude CLI npm install failed: {}", stderr.trim());
        let _ = std::fs::remove_dir_all(&temp_dir);
        return Err(SdkError::CliNotFound {
            searched_paths: format!(
                "Failed to automatically install Claude Code CLI.\n\
                Please install manually:\n\n\
                npm install -g {CLAUDE_CODE_NPM_PACKAGE}@{version}\n\n\
                Error details: {}",
                stderr.trim()
            ),
        });
    }

    // 2. Run the package's own installer to fetch the real native binary into
    //    bin/claude.exe (the postinstall we skipped above). Invoked exactly as the
    //    package documents: `node node_modules/<pkg>/install.cjs` from the prefix.
    let installer_rel = format!("node_modules/{CLAUDE_CODE_NPM_PACKAGE}/install.cjs");
    let postinstall = Command::new("node")
        .arg(&installer_rel)
        .current_dir(&temp_dir)
        .output()
        .await
        .map_err(SdkError::ProcessError)?;
    if !postinstall.status.success() {
        let stderr = String::from_utf8_lossy(&postinstall.stderr);
        let _ = std::fs::remove_dir_all(&temp_dir);
        return Err(SdkError::ConfigError(format!(
            "Claude CLI postinstall (install.cjs) failed: {}",
            stderr.trim()
        )));
    }

    // 3. The real native binary now lives at bin/claude.exe. Verify it is a real
    //    binary (not the ~500-byte shim) before atomically installing it; on any
    //    problem we leave the existing managed binary untouched.
    let native_binary = temp_dir
        .join("node_modules")
        .join(CLAUDE_CODE_NPM_PACKAGE)
        .join(CLAUDE_NATIVE_BIN_REL);
    match std::fs::metadata(&native_binary) {
        Ok(meta) if meta.len() >= MIN_NATIVE_BINARY_BYTES => {}
        Ok(meta) => {
            let _ = std::fs::remove_dir_all(&temp_dir);
            return Err(SdkError::ConfigError(format!(
                "Claude CLI native binary at {} is only {} bytes after postinstall (expected a real binary); refusing to install a shim",
                native_binary.display(),
                meta.len()
            )));
        }
        Err(error) => {
            let _ = std::fs::remove_dir_all(&temp_dir);
            return Err(SdkError::ConfigError(format!(
                "Claude CLI native binary missing after postinstall at {}: {error}",
                native_binary.display()
            )));
        }
    }

    let install_result = atomically_install_binary(&native_binary, target_path);
    let _ = std::fs::remove_dir_all(&temp_dir);
    install_result?;

    if let Some(ref progress) = on_progress {
        progress(100, Some(100));
    }
    Ok(target_path.to_path_buf())
}

/// Ensure the CLI is available, downloading if necessary
///
/// This is the main entry point for CLI management.
#[allow(dead_code)]
pub async fn ensure_cli(auto_download: bool) -> Result<PathBuf> {
    // First, try the managed CLI resolver.
    if let Ok(path) = super::transport::subprocess::find_claude_cli() {
        return Ok(path);
    }

    // Download if auto_download is enabled
    if auto_download {
        info!("Claude Code CLI not found, downloading...");
        return download_cli(None, None).await;
    }

    Err(SdkError::CliNotFound {
        searched_paths: "Claude Code CLI not found.\n\n\
            To automatically download, create the client with auto_download enabled:\n\
            ```rust\n\
            let options = ClaudeCodeOptions::builder()\n\
                .auto_download_cli(true)\n\
                .build();\n\
            ```\n\n\
            Or install manually:\n\
            npm install -g @anthropic-ai/claude-code"
            .to_string(),
    })
}

/// Pure decision for the update check, given the resolved versions. Floor takes
/// precedence so a (hypothetical) latest below the floor is never installed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum UpdatePlan {
    Update,
    AlreadyCurrent,
    BelowFloor,
}

fn plan_update(current: SemVer, latest: SemVer, floor: SemVer) -> UpdatePlan {
    if latest < floor {
        UpdatePlan::BelowFloor
    } else if current >= latest {
        UpdatePlan::AlreadyCurrent
    } else {
        UpdatePlan::Update
    }
}

/// Outcome of an [`ensure_managed_claude_up_to_date`] check.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum UpdateOutcome {
    /// The managed binary was advanced from `from` to `to`.
    Updated { from: SemVer, to: SemVer },
    /// The cached binary is already at or above the latest published release.
    AlreadyCurrent,
    /// No managed binary present yet — cold install is owned by the install flow
    /// (`client_factory` → `install_agent`), not the update check.
    SkippedCold,
    /// Latest version could not be resolved (offline / registry error). Existing
    /// binary left untouched.
    SkippedOffline,
    /// Reading the installed version, the floor check, or the download failed.
    /// Existing binary left untouched.
    SkippedError,
}

/// Keep Acepe's managed Claude CLI current by advancing it to the latest published
/// release (always-latest policy; floor enforced, no ceiling).
///
/// **Best-effort and non-blocking by contract:** every operational failure returns a
/// non-error `Skipped*` outcome and leaves the existing cached binary untouched. This
/// function never returns the binary path and is safe to fire-and-forget from startup.
///
/// Cold install (binary absent) is intentionally **not** handled here — it returns
/// [`UpdateOutcome::SkippedCold`] so the install flow (`client_factory` →
/// `install_agent`, which holds `install_guard`) owns first provisioning and the two
/// paths never race on the shared cache/target.
pub(crate) async fn ensure_managed_claude_up_to_date() -> UpdateOutcome {
    let Some(cli_path) = get_cached_cli_path() else {
        return UpdateOutcome::SkippedCold;
    };
    if !cli_path.exists() {
        return UpdateOutcome::SkippedCold;
    }

    let latest = match resolve_latest_cli_version().await {
        Ok(latest) => latest,
        Err(error) => {
            debug!("Skipping Claude CLI update: could not resolve latest version: {error}");
            return UpdateOutcome::SkippedOffline;
        }
    };

    let current = match super::transport::subprocess::read_claude_cli_version(&cli_path) {
        Ok(current) => current,
        Err(error) => {
            // Can't read the installed version — don't risk replacing a working binary.
            warn!("Skipping Claude CLI update: could not read installed version: {error}");
            return UpdateOutcome::SkippedError;
        }
    };

    let floor = SemVer::parse(MIN_CLI_VERSION).unwrap_or_else(|| SemVer::new(2, 1, 0));
    match plan_update(current, latest, floor) {
        UpdatePlan::AlreadyCurrent => return UpdateOutcome::AlreadyCurrent,
        UpdatePlan::BelowFloor => {
            warn!(
                "Latest Claude CLI {}.{}.{} is below the supported floor {}.{}.{}; skipping update",
                latest.major, latest.minor, latest.patch, floor.major, floor.minor, floor.patch
            );
            return UpdateOutcome::SkippedError;
        }
        UpdatePlan::Update => {}
    }

    let to_version = format!("{}.{}.{}", latest.major, latest.minor, latest.patch);
    info!(
        "Updating managed Claude CLI {}.{}.{} -> {}",
        current.major, current.minor, current.patch, to_version
    );

    match download_cli(Some(&to_version), None).await {
        Ok(_) => UpdateOutcome::Updated {
            from: current,
            to: latest,
        },
        Err(error) => {
            warn!("Claude CLI update download failed; keeping existing binary: {error}");
            UpdateOutcome::SkippedError
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_cache_dir() {
        let cache_dir = get_cache_dir();
        assert!(cache_dir.is_some());
        let dir = cache_dir.unwrap();
        assert!(dir.to_string_lossy().contains("cc-sdk"));
    }

    #[test]
    fn test_get_cached_cli_path() {
        let cli_path = get_cached_cli_path();
        assert!(cli_path.is_some());
        let path = cli_path.unwrap();
        if cfg!(windows) {
            assert!(path.to_string_lossy().ends_with("claude.exe"));
        } else {
            assert!(path.to_string_lossy().ends_with("claude"));
        }
    }

    #[test]
    fn test_cli_version_constants() {
        // Verify the minimum supported version floor is set and not a moving tag.
        assert!(!MIN_CLI_VERSION.is_empty());
        assert_ne!(MIN_CLI_VERSION, "latest");

        // Verify MIN_CLI_VERSION is valid semver-ish format
        let parts: Vec<&str> = MIN_CLI_VERSION.split('.').collect();
        assert_eq!(
            parts.len(),
            3,
            "MIN_CLI_VERSION should be semver format x.y.z"
        );
    }

    #[test]
    fn test_download_package_requires_exact_version() {
        assert_eq!(
            npm_package_for_version("2.1.0").expect("exact version should be accepted"),
            "@anthropic-ai/claude-code@2.1.0".to_string()
        );
        // Any exact x.y.z is now accepted (no per-version integrity pin).
        assert_eq!(
            npm_package_for_version("2.1.185").expect("arbitrary exact version accepted"),
            "@anthropic-ai/claude-code@2.1.185".to_string()
        );
        assert!(npm_package_for_version("latest").is_err());
        assert!(npm_package_for_version("^2.1.0").is_err());
        assert!(npm_package_for_version("2.1").is_err());
    }

    #[test]
    fn test_parse_exact_release_rejects_non_exact() {
        assert_eq!(parse_exact_release("2.1.185"), Some(SemVer::new(2, 1, 185)));
        // Lenient SemVer::parse would drop these suffixes; parse_exact_release must not.
        assert_eq!(parse_exact_release("2.2.0-rc.1"), None);
        assert_eq!(parse_exact_release("2.1"), None);
        assert_eq!(parse_exact_release("latest"), None);
        assert_eq!(parse_exact_release("v2.1.0"), None);
    }

    #[test]
    fn test_latest_from_dist_tags() {
        let ok = serde_json::json!({ "latest": "2.1.185", "next": "2.2.0-beta.1" });
        assert_eq!(
            latest_from_dist_tags(&ok).expect("clean latest parses"),
            SemVer::new(2, 1, 185)
        );

        // Prerelease `latest` is skipped (returns Err → caller treats as no-op).
        let prerelease = serde_json::json!({ "latest": "2.2.0-rc.1" });
        assert!(latest_from_dist_tags(&prerelease).is_err());

        // Missing / malformed payloads error rather than panic.
        assert!(latest_from_dist_tags(&serde_json::json!({})).is_err());
        assert!(latest_from_dist_tags(&serde_json::json!({ "latest": 12 })).is_err());
    }

    #[test]
    fn test_plan_update_decision() {
        let floor = SemVer::new(2, 1, 0);
        // Newer available → update.
        assert_eq!(
            plan_update(SemVer::new(2, 1, 150), SemVer::new(2, 1, 185), floor),
            UpdatePlan::Update
        );
        // Equal → already current.
        assert_eq!(
            plan_update(SemVer::new(2, 1, 185), SemVer::new(2, 1, 185), floor),
            UpdatePlan::AlreadyCurrent
        );
        // Cached newer than latest (shouldn't happen) → no downgrade.
        assert_eq!(
            plan_update(SemVer::new(2, 2, 0), SemVer::new(2, 1, 185), floor),
            UpdatePlan::AlreadyCurrent
        );
        // Latest below floor → refuse, even when newer than cached.
        assert_eq!(
            plan_update(SemVer::new(2, 0, 0), SemVer::new(2, 0, 5), floor),
            UpdatePlan::BelowFloor
        );
    }

    #[test]
    fn test_cache_dir_platform_specific() {
        let cache_dir = get_cache_dir().expect("Should get cache dir");

        #[cfg(target_os = "macos")]
        {
            assert!(cache_dir.to_string_lossy().contains("Library/Caches"));
            assert!(cache_dir.to_string_lossy().contains("cc-sdk/cli"));
        }

        #[cfg(all(unix, not(target_os = "macos")))]
        {
            assert!(
                cache_dir.to_string_lossy().contains(".cache")
                    || cache_dir.to_string_lossy().contains("cache")
            );
            assert!(cache_dir.to_string_lossy().contains("cc-sdk"));
        }

        #[cfg(target_os = "windows")]
        {
            assert!(cache_dir.to_string_lossy().contains("cc-sdk"));
        }
    }

    #[test]
    fn test_is_cli_cached_when_not_cached() {
        // Since we haven't downloaded anything, CLI should not be cached
        // (unless running on a machine where it was already downloaded)
        // We can't assert false because it might be cached on some machines
        // Just verify the function doesn't panic
        let _ = is_cli_cached();
    }

    #[test]
    fn test_cached_cli_path_is_in_cache_dir() {
        let cache_dir = get_cache_dir().expect("Should get cache dir");
        let cli_path = get_cached_cli_path().expect("Should get cli path");

        // CLI path should be inside cache dir
        assert!(cli_path.starts_with(&cache_dir));

        // CLI should be the executable name
        let cli_name = cli_path.file_name().expect("Should have file name");
        if cfg!(windows) {
            assert_eq!(cli_name, "claude.exe");
        } else {
            assert_eq!(cli_name, "claude");
        }
    }
}
