use acepe_lib::voice::models::ModelManager;
use std::fs;

#[test]
fn list_models_includes_catalog_entry_and_download_status() {
    let temp_dir = tempfile::tempdir().expect("tempdir should be created");
    let manager = ModelManager::new(temp_dir.path());

    let models = manager.list_models();

    assert!(models.len() >= 8);
    let small_en = models
        .iter()
        .find(|model| model.id == "small.en")
        .expect("small.en should be present in the catalog");
    assert_eq!(small_en.name, "Small (English)");
    assert!(!small_en.is_downloaded);
}

#[test]
fn validate_model_id_rejects_unknown_and_traversal_inputs() {
    assert!(ModelManager::validate_model_id("small.en").is_ok());
    assert!(ModelManager::validate_model_id("../../etc/passwd").is_err());
    assert!(ModelManager::validate_model_id("unknown").is_err());
}

#[test]
fn model_path_uses_whisper_models_directory() {
    let temp_dir = tempfile::tempdir().expect("tempdir should be created");
    let manager = ModelManager::new(temp_dir.path());

    let path = manager
        .model_path("tiny.en")
        .expect("known model should map to a path");

    assert!(path.ends_with("models/whisper/ggml-tiny.en.bin"));
}

#[test]
fn validate_url_allows_only_expected_huggingface_hosts() {
    let allowed = reqwest::Url::parse(
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin",
    )
    .expect("allowed URL should parse");
    let allowed_redirect =
        reqwest::Url::parse("https://cdn-lfs.huggingface.co/repos/abc/ggml-small.en.bin")
            .expect("allowed redirect URL should parse");
    let rejected = reqwest::Url::parse("https://example.com/ggml-small.en.bin")
        .expect("rejected URL should parse");

    assert!(ModelManager::validate_url(&allowed));
    assert!(ModelManager::validate_url(&allowed_redirect));
    assert!(!ModelManager::validate_url(&rejected));
}

#[test]
fn validate_model_rejects_corrupt_downloads() {
    let temp_dir = tempfile::tempdir().expect("tempdir should be created");
    let manager = ModelManager::new(temp_dir.path());
    let path = manager
        .model_path("tiny.en")
        .expect("known model should map to a path");
    fs::create_dir_all(path.parent().expect("model path should have a parent"))
        .expect("models directory should be created");
    fs::write(&path, b"not-a-real-model").expect("corrupt model file should be written");

    let error = manager
        .validate_model("tiny.en", &path)
        .expect_err("corrupt model should be rejected");

    let message = error.to_string();
    assert!(message.contains("Model size mismatch") || message.contains("checksum mismatch"));
}
