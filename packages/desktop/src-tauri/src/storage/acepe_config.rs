use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::fmt::{Display, Formatter};
use std::io::Write;
use std::path::{Path, PathBuf};

const CONFIG_FILE_NAME: &str = ".acepe.json";
const TEMP_FILE_NAME: &str = ".acepe.json.tmp";
const SUPPORTED_VERSION: u32 = 1;

#[derive(Debug)]
pub enum AcepeConfigError {
    Io(std::io::Error),
    Parse(serde_json::Error),
    UnsupportedVersion(u32),
    OutsideProjectRoot(String),
}

impl Display for AcepeConfigError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            AcepeConfigError::Io(error) => write!(f, "I/O error: {}", error),
            AcepeConfigError::Parse(error) => write!(f, "JSON parse error: {}", error),
            AcepeConfigError::UnsupportedVersion(version) => {
                write!(f, "Unsupported .acepe.json version: {}", version)
            }
            AcepeConfigError::OutsideProjectRoot(message) => write!(f, "{}", message),
        }
    }
}

impl std::error::Error for AcepeConfigError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            AcepeConfigError::Io(error) => Some(error),
            AcepeConfigError::Parse(error) => Some(error),
            AcepeConfigError::UnsupportedVersion(_) | AcepeConfigError::OutsideProjectRoot(_) => {
                None
            }
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AcepeConfig {
    pub version: u32,
    #[serde(default)]
    pub scripts: ScriptsSection,
    #[serde(default)]
    pub external_cli_sessions: ExternalCliSessionsSection,
    #[serde(flatten)]
    pub extras: BTreeMap<String, Value>,
}

impl Default for AcepeConfig {
    fn default() -> Self {
        Self {
            version: SUPPORTED_VERSION,
            scripts: ScriptsSection::default(),
            external_cli_sessions: ExternalCliSessionsSection::default(),
            extras: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct ScriptsSection {
    #[serde(default)]
    pub setup: String,
    #[serde(default)]
    pub run: String,
    #[serde(flatten)]
    pub extras: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ExternalCliSessionsSection {
    #[serde(default = "default_show_external_cli_sessions")]
    pub show: bool,
    #[serde(flatten)]
    pub extras: BTreeMap<String, Value>,
}

impl Default for ExternalCliSessionsSection {
    fn default() -> Self {
        Self {
            show: default_show_external_cli_sessions(),
            extras: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawAcepeConfig {
    #[serde(default = "default_supported_version")]
    version: u32,
    #[serde(default)]
    scripts: ScriptsSection,
    #[serde(default)]
    external_cli_sessions: ExternalCliSessionsSection,
    #[serde(default)]
    worktree: LegacyWorktreeSection,
    #[serde(flatten)]
    extras: BTreeMap<String, Value>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyWorktreeSection {
    #[serde(default)]
    setup_commands: Vec<String>,
}

impl RawAcepeConfig {
    fn into_config(self) -> AcepeConfig {
        let legacy_setup = self
            .worktree
            .setup_commands
            .iter()
            .map(String::as_str)
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .collect::<Vec<_>>()
            .join("\n");

        let setup = if self.scripts.setup.is_empty() && !legacy_setup.is_empty() {
            legacy_setup
        } else {
            self.scripts.setup
        };

        AcepeConfig {
            version: self.version,
            scripts: ScriptsSection {
                setup,
                run: self.scripts.run,
                extras: self.scripts.extras,
            },
            external_cli_sessions: self.external_cli_sessions,
            extras: self.extras,
        }
    }
}

fn default_show_external_cli_sessions() -> bool {
    true
}

fn default_supported_version() -> u32 {
    SUPPORTED_VERSION
}

fn config_path(project_root: &Path) -> Result<PathBuf, AcepeConfigError> {
    if !project_root.is_absolute() {
        return Err(AcepeConfigError::OutsideProjectRoot(format!(
            "Project root must be absolute: {}",
            project_root.display()
        )));
    }

    let path = project_root.join(CONFIG_FILE_NAME);
    let Some(parent) = path.parent() else {
        return Err(AcepeConfigError::OutsideProjectRoot(format!(
            "Resolved config path has no parent: {}",
            path.display()
        )));
    };

    if parent != project_root {
        return Err(AcepeConfigError::OutsideProjectRoot(format!(
            "Resolved config path escapes the project root: {}",
            path.display()
        )));
    }

    Ok(path)
}

fn temp_path(project_root: &Path) -> Result<PathBuf, AcepeConfigError> {
    let path = project_root.join(TEMP_FILE_NAME);
    let Some(parent) = path.parent() else {
        return Err(AcepeConfigError::OutsideProjectRoot(format!(
            "Resolved temp config path has no parent: {}",
            path.display()
        )));
    };

    if parent != project_root {
        return Err(AcepeConfigError::OutsideProjectRoot(format!(
            "Resolved temp config path escapes the project root: {}",
            path.display()
        )));
    }

    Ok(path)
}

fn sync_directory(path: &Path) -> Result<(), AcepeConfigError> {
    let directory = std::fs::File::open(path).map_err(AcepeConfigError::Io)?;
    directory.sync_all().map_err(AcepeConfigError::Io)
}

pub fn read(project_root: &Path) -> Result<AcepeConfig, AcepeConfigError> {
    let path = config_path(project_root)?;
    if !path.exists() {
        return Ok(AcepeConfig::default());
    }

    let content = std::fs::read_to_string(path).map_err(AcepeConfigError::Io)?;
    let raw = serde_json::from_str::<RawAcepeConfig>(&content).map_err(AcepeConfigError::Parse)?;
    if raw.version != SUPPORTED_VERSION {
        return Err(AcepeConfigError::UnsupportedVersion(raw.version));
    }

    Ok(raw.into_config())
}

pub fn read_or_default(project_root: &Path) -> AcepeConfig {
    match read(project_root) {
        Ok(config) => config,
        Err(error) => {
            tracing::warn!(
                error = %error,
                project_root = %project_root.display(),
                "Failed to read .acepe.json; using defaults"
            );
            AcepeConfig::default()
        }
    }
}

pub fn ensure_exists(project_root: &Path) -> Result<AcepeConfig, AcepeConfigError> {
    let path = config_path(project_root)?;
    if path.exists() {
        return read(project_root);
    }

    let config = AcepeConfig::default();
    write(project_root, &config)?;
    Ok(config)
}

pub fn write(project_root: &Path, config: &AcepeConfig) -> Result<(), AcepeConfigError> {
    let path = config_path(project_root)?;
    let temp = temp_path(project_root)?;
    let serialized = serde_json::to_string_pretty(config).map_err(AcepeConfigError::Parse)?;
    let content = format!("{}\n", serialized);

    let mut file = std::fs::File::create(&temp).map_err(AcepeConfigError::Io)?;
    file.write_all(content.as_bytes())
        .map_err(AcepeConfigError::Io)?;
    file.sync_all().map_err(AcepeConfigError::Io)?;
    drop(file);

    std::fs::rename(&temp, &path).map_err(AcepeConfigError::Io)?;
    sync_directory(project_root)?;

    Ok(())
}

pub fn update<F>(project_root: &Path, mutator: F) -> Result<AcepeConfig, AcepeConfigError>
where
    F: FnOnce(&mut AcepeConfig),
{
    let mut config = read(project_root)?;
    mutator(&mut config);
    write(project_root, &config)?;
    Ok(config)
}

#[cfg(test)]
mod tests {
    use super::{
        ensure_exists, read, update, write, AcepeConfig, AcepeConfigError,
        ExternalCliSessionsSection, ScriptsSection,
    };
    use serde_json::json;
    use tempfile::tempdir;

    #[test]
    fn read_returns_defaults_when_file_is_missing() {
        let directory = tempdir().expect("tempdir");
        let config = read(directory.path()).expect("read default config");

        assert_eq!(config.version, 1);
        assert_eq!(config.scripts.setup, "");
        assert_eq!(config.scripts.run, "");
        assert!(config.external_cli_sessions.show);
    }

    #[test]
    fn round_trips_and_writes_stable_shape() {
        let directory = tempdir().expect("tempdir");
        let config = AcepeConfig {
            version: 1,
            scripts: ScriptsSection {
                setup: "bun install\nbun test".to_string(),
                run: "bun run dev".to_string(),
                extras: Default::default(),
            },
            external_cli_sessions: ExternalCliSessionsSection {
                show: false,
                extras: Default::default(),
            },
            extras: Default::default(),
        };

        write(directory.path(), &config).expect("write config");
        let written = std::fs::read_to_string(directory.path().join(".acepe.json"))
            .expect("read written file");
        let loaded = read(directory.path()).expect("reload config");

        assert!(written.ends_with('\n'));
        assert_eq!(loaded, config);
        assert_eq!(
            written,
            "{\n  \"version\": 1,\n  \"scripts\": {\n    \"setup\": \"bun install\\nbun test\",\n    \"run\": \"bun run dev\"\n  },\n  \"externalCliSessions\": {\n    \"show\": false\n  }\n}\n"
        );
    }

    #[test]
    fn preserves_unknown_fields_and_reads_legacy_setup_commands() {
        let directory = tempdir().expect("tempdir");
        std::fs::write(
            directory.path().join(".acepe.json"),
            "{\n  \"version\": 1,\n  \"scripts\": {\n    \"run\": \"bun run dev\",\n    \"futureScript\": true\n  },\n  \"externalCliSessions\": {\n    \"show\": false,\n    \"futureVisibility\": \"keep\"\n  },\n  \"futureTopLevel\": 7,\n  \"worktree\": {\n    \"setupCommands\": [\"bun install\", \"bun test\"]\n  }\n}\n",
        )
        .expect("seed config");

        let loaded = read(directory.path()).expect("read legacy config");
        assert_eq!(loaded.scripts.setup, "bun install\nbun test");
        assert_eq!(loaded.scripts.run, "bun run dev");
        assert_eq!(loaded.extras.get("futureTopLevel"), Some(&json!(7)));
        assert_eq!(
            loaded.scripts.extras.get("futureScript"),
            Some(&json!(true))
        );
        assert_eq!(
            loaded.external_cli_sessions.extras.get("futureVisibility"),
            Some(&json!("keep"))
        );

        write(directory.path(), &loaded).expect("rewrite config");
        let rewritten = std::fs::read_to_string(directory.path().join(".acepe.json"))
            .expect("read rewritten config");
        assert!(!rewritten.contains("\"worktree\""));
        assert!(rewritten.contains("\"futureTopLevel\": 7"));
        assert!(rewritten.contains("\"futureScript\": true"));
    }

    #[test]
    fn malformed_json_returns_parse_error() {
        let directory = tempdir().expect("tempdir");
        std::fs::write(directory.path().join(".acepe.json"), "{ invalid json")
            .expect("write malformed file");

        let error = read(directory.path()).expect_err("expected parse error");
        assert!(matches!(error, AcepeConfigError::Parse(_)));
    }

    #[test]
    fn unsupported_version_returns_error() {
        let directory = tempdir().expect("tempdir");
        std::fs::write(
            directory.path().join(".acepe.json"),
            "{\n  \"version\": 2\n}\n",
        )
        .expect("write unsupported config");

        let error = read(directory.path()).expect_err("expected version error");
        assert!(matches!(error, AcepeConfigError::UnsupportedVersion(2)));
    }

    #[test]
    fn stale_tmp_file_does_not_replace_existing_config() {
        let directory = tempdir().expect("tempdir");
        let original = AcepeConfig {
            version: 1,
            scripts: ScriptsSection {
                setup: "bun install".to_string(),
                run: String::new(),
                extras: Default::default(),
            },
            external_cli_sessions: ExternalCliSessionsSection::default(),
            extras: Default::default(),
        };

        write(directory.path(), &original).expect("write original");
        std::fs::write(
            directory.path().join(".acepe.json.tmp"),
            "{\n  \"version\": 1,\n  \"scripts\": {\n    \"setup\": \"rm -rf .\",\n    \"run\": \"\"\n  },\n  \"externalCliSessions\": {\n    \"show\": false\n  }\n}\n",
        )
        .expect("seed temp file");

        let loaded = read(directory.path()).expect("read original config");
        assert_eq!(loaded.scripts.setup, "bun install");
        assert!(loaded.external_cli_sessions.show);
    }

    #[test]
    fn update_mutates_existing_config_and_rewrites_file() {
        let directory = tempdir().expect("tempdir");
        write(directory.path(), &AcepeConfig::default()).expect("seed default config");

        let updated = update(directory.path(), |config| {
            config.scripts.setup = "bun install".to_string();
            config.external_cli_sessions.show = false;
        })
        .expect("update config");

        assert_eq!(updated.scripts.setup, "bun install");
        assert!(!updated.external_cli_sessions.show);
        let reloaded = read(directory.path()).expect("reload updated config");
        assert_eq!(reloaded, updated);
    }

    #[test]
    fn ensure_exists_creates_default_file_when_missing() {
        let directory = tempdir().expect("tempdir");

        let config = ensure_exists(directory.path()).expect("ensure config");

        assert!(directory.path().join(".acepe.json").exists());
        assert_eq!(config, AcepeConfig::default());
    }
}
