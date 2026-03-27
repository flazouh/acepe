use std::fs;

use acepe_lib::voice::models_validation::{
    save_validation_metadata, validation_metadata_path, ValidationMetadata,
};

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
