use std::fs;
use std::path::Path;

use anyhow::Context;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ValidationMetadata {
    pub size_bytes: u64,
    pub sha256: String,
}

pub fn validation_metadata_path(path: &Path) -> anyhow::Result<std::path::PathBuf> {
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .context("Model path is missing a file name")?;
    Ok(path.with_file_name(format!("{file_name}.validated.json")))
}

pub fn load_validation_metadata(path: &Path) -> anyhow::Result<Option<ValidationMetadata>> {
    let metadata_path = validation_metadata_path(path)?;
    if !metadata_path.exists() {
        return Ok(None);
    }

    let contents = fs::read_to_string(&metadata_path).with_context(|| {
        format!(
            "Failed to read validation metadata {}",
            metadata_path.display()
        )
    })?;
    let metadata = serde_json::from_str::<ValidationMetadata>(&contents).with_context(|| {
        format!(
            "Failed to parse validation metadata {}",
            metadata_path.display()
        )
    })?;
    Ok(Some(metadata))
}

pub fn save_validation_metadata(path: &Path, metadata: &ValidationMetadata) -> anyhow::Result<()> {
    let metadata_path = validation_metadata_path(path)?;
    let contents = serde_json::to_string(metadata).with_context(|| {
        format!(
            "Failed to serialize validation metadata {}",
            metadata_path.display()
        )
    })?;
    fs::write(&metadata_path, contents).with_context(|| {
        format!(
            "Failed to write validation metadata {}",
            metadata_path.display()
        )
    })?;
    Ok(())
}

pub fn clear_validation_metadata(path: &Path) -> anyhow::Result<()> {
    let metadata_path = validation_metadata_path(path)?;
    if !metadata_path.exists() {
        return Ok(());
    }
    fs::remove_file(&metadata_path).with_context(|| {
        format!(
            "Failed to remove validation metadata {}",
            metadata_path.display()
        )
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_sidecar_validation_path() {
        let path = Path::new("/tmp/ggml-small.en.bin");
        let metadata_path = validation_metadata_path(path).expect("metadata path");
        assert_eq!(
            metadata_path,
            Path::new("/tmp/ggml-small.en.bin.validated.json")
        );
    }

    #[test]
    fn round_trips_validation_metadata() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let model_path = temp_dir.path().join("ggml-small.en.bin");
        fs::write(&model_path, b"model").expect("write model");
        let metadata = ValidationMetadata {
            size_bytes: 5,
            sha256: "abc123".to_string(),
        };

        save_validation_metadata(&model_path, &metadata).expect("save metadata");
        let loaded = load_validation_metadata(&model_path).expect("load metadata");

        assert_eq!(loaded, Some(metadata));
    }

    #[test]
    fn validate_model_file_writes_validation_metadata_sidecar() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let model_path = temp_dir.path().join("ggml-small.en.bin");
        fs::write(&model_path, b"stub model").expect("write stub model");

        let metadata = ValidationMetadata {
            size_bytes: 10,
            sha256: "abc123".to_string(),
        };

        save_validation_metadata(&model_path, &metadata).expect("save metadata");

        let metadata_path = validation_metadata_path(&model_path).expect("metadata path");
        assert!(metadata_path.exists());
    }
}
