use anyhow::Context;
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::Digest;
use std::path::{Path, PathBuf};
use std::{fs, io::Read};
use tokio::io::AsyncWriteExt;

const MAX_DOWNLOAD_SIZE_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MODEL_DOWNLOAD_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(600);

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    pub size_bytes: u64,
    pub is_english_only: bool,
    pub is_downloaded: bool,
    pub download_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct ModelDownloadProgress {
    pub model_id: String,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub percent: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct ModelDownloadComplete {
    pub model_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct ModelDownloadError {
    pub model_id: String,
    pub message: String,
}

#[derive(Debug, Clone)]
struct ModelSpec {
    id: &'static str,
    name: &'static str,
    size_bytes: u64,
    is_english_only: bool,
    sha256: &'static str,
    url: &'static str,
}

const MODEL_CATALOG: &[ModelSpec] = &[
    ModelSpec {
        id: "tiny.en",
        name: "Tiny (English)",
        size_bytes: 77_704_715,
        is_english_only: true,
        sha256: "921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin",
    },
    ModelSpec {
        id: "tiny",
        name: "Tiny (Multilingual)",
        size_bytes: 77_691_713,
        is_english_only: false,
        sha256: "be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
    },
    ModelSpec {
        id: "base.en",
        name: "Base (English)",
        size_bytes: 147_964_211,
        is_english_only: true,
        sha256: "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin",
    },
    ModelSpec {
        id: "base",
        name: "Base (Multilingual)",
        size_bytes: 147_951_465,
        is_english_only: false,
        sha256: "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
    },
    ModelSpec {
        id: "small.en",
        name: "Small (English)",
        size_bytes: 487_614_201,
        is_english_only: true,
        sha256: "c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin",
    },
    ModelSpec {
        id: "small",
        name: "Small (Multilingual)",
        size_bytes: 487_601_967,
        is_english_only: false,
        sha256: "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
    },
    ModelSpec {
        id: "medium.en",
        name: "Medium (English)",
        size_bytes: 1_533_774_781,
        is_english_only: true,
        sha256: "cc37e93478338ec7700281a7ac30a10128929eb8f427dda2e865faa8f6da4356",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.en.bin",
    },
    ModelSpec {
        id: "medium",
        name: "Medium (Multilingual)",
        size_bytes: 1_533_763_059,
        is_english_only: false,
        sha256: "6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin",
    },
];

pub struct ModelManager {
    models_dir: PathBuf,
}

impl ModelManager {
    pub fn new(app_data_dir: &Path) -> Self {
        let models_dir = app_data_dir.join("models").join("whisper");
        Self { models_dir }
    }

    pub fn list_models(&self) -> Vec<ModelInfo> {
        MODEL_CATALOG
            .iter()
            .map(|spec| self.build_model_info(spec))
            .collect()
    }

    pub fn is_model_available(&self, model_id: &str) -> bool {
        match self.model_path(model_id) {
            Some(path) => self.validate_model(model_id, &path).is_ok(),
            None => false,
        }
    }

    pub fn model_path(&self, model_id: &str) -> Option<PathBuf> {
        Self::find_spec(model_id).map(|spec| self.models_dir.join(format!("ggml-{}.bin", spec.id)))
    }

    pub fn validate_model(&self, model_id: &str, path: &Path) -> anyhow::Result<()> {
        let spec = Self::find_spec(model_id).context("Unknown voice model")?;
        let metadata = fs::metadata(path)
            .with_context(|| format!("Failed to read metadata for {}", path.display()))?;

        if metadata.len() != spec.size_bytes {
            anyhow::bail!(
                "Model size mismatch for {}: expected {}, got {}",
                spec.id,
                spec.size_bytes,
                metadata.len()
            );
        }

        let mut file = fs::File::open(path)
            .with_context(|| format!("Failed to open model file {}", path.display()))?;
        let mut hasher = sha2::Sha256::new();
        let mut buffer = [0_u8; 64 * 1024];

        loop {
            let read = file
                .read(&mut buffer)
                .with_context(|| format!("Failed to read model file {}", path.display()))?;
            if read == 0 {
                break;
            }
            hasher.update(&buffer[..read]);
        }

        let digest = format!("{:x}", hasher.finalize());
        if digest != spec.sha256 {
            anyhow::bail!(
                "Model checksum mismatch for {}: expected {}, got {}",
                spec.id,
                spec.sha256,
                digest
            );
        }

        Ok(())
    }

    pub fn validate_model_id(model_id: &str) -> anyhow::Result<()> {
        Self::find_spec(model_id)
            .map(|_| ())
            .context("Unknown voice model")
    }

    pub fn validate_url(url: &reqwest::Url) -> bool {
        const ALLOWED_HOSTS: &[&str] = &[
            "huggingface.co",
            "cdn-lfs.huggingface.co",
            "cdn-lfs-us-1.huggingface.co",
            "cdn-lfs-eu-1.huggingface.co",
            "cas-bridge.xethub.hf.co",
        ];

        url.scheme() == "https"
            && url
                .host_str()
                .is_some_and(|host| ALLOWED_HOSTS.contains(&host))
    }

    pub fn get_model_info(&self, model_id: &str) -> anyhow::Result<ModelInfo> {
        let spec = Self::find_spec(model_id).context("Unknown voice model")?;
        Ok(self.build_model_info(spec))
    }

    pub fn delete_model(&self, model_id: &str) -> anyhow::Result<()> {
        let path = self.model_path(model_id).context("Unknown voice model")?;

        if path.exists() {
            fs::remove_file(&path)
                .with_context(|| format!("Failed to delete model file {}", path.display()))?;
        }

        Ok(())
    }

    pub async fn download_model<F>(
        &self,
        model_id: &str,
        mut emit_progress: F,
    ) -> anyhow::Result<PathBuf>
    where
        F: FnMut(ModelDownloadProgress),
    {
        let spec = Self::find_spec(model_id).context("Unknown voice model")?;
        fs::create_dir_all(&self.models_dir).with_context(|| {
            format!(
                "Failed to create models directory {}",
                self.models_dir.display()
            )
        })?;

        let final_path = self.models_dir.join(format!("ggml-{}.bin", spec.id));
        if self.validate_model(spec.id, &final_path).is_ok() {
            emit_progress(ModelDownloadProgress {
                model_id: spec.id.to_string(),
                downloaded_bytes: spec.size_bytes,
                total_bytes: spec.size_bytes,
                percent: 100.0,
            });
            return Ok(final_path);
        }

        let temp_path = self
            .models_dir
            .join(format!("ggml-{}.bin.downloading", spec.id));
        if temp_path.exists() {
            let _ = fs::remove_file(&temp_path);
        }

        let request_url = reqwest::Url::parse(spec.url).context("Invalid model URL")?;
        if !Self::validate_url(&request_url) {
            anyhow::bail!("Blocked model URL for {}", spec.id);
        }

        let client = reqwest::Client::builder()
            .timeout(MODEL_DOWNLOAD_TIMEOUT)
            .build()
            .context("Failed to build HTTP client")?;

        let response = client
            .get(request_url.clone())
            .send()
            .await
            .with_context(|| format!("Failed to start model download for {}", spec.id))?
            .error_for_status()
            .with_context(|| format!("Model download failed for {}", spec.id))?;

        if !Self::validate_url(response.url()) {
            anyhow::bail!("Blocked redirect host while downloading {}", spec.id);
        }

        let total_bytes = response.content_length().unwrap_or(spec.size_bytes);
        if total_bytes > MAX_DOWNLOAD_SIZE_BYTES {
            anyhow::bail!(
                "Model {} exceeds max download size cap ({})",
                spec.id,
                MAX_DOWNLOAD_SIZE_BYTES
            );
        }

        let mut file = tokio::fs::File::create(&temp_path)
            .await
            .with_context(|| format!("Failed to create temp file {}", temp_path.display()))?;
        let mut downloaded_bytes = 0_u64;
        let mut stream = response.bytes_stream();

        while let Some(chunk) = stream.next().await {
            let chunk = chunk.with_context(|| format!("Failed while downloading {}", spec.id))?;
            downloaded_bytes = downloaded_bytes
                .checked_add(chunk.len() as u64)
                .context("Model download byte counter overflowed")?;

            if downloaded_bytes > MAX_DOWNLOAD_SIZE_BYTES {
                let _ = tokio::fs::remove_file(&temp_path).await;
                anyhow::bail!(
                    "Model {} exceeded max download size cap ({})",
                    spec.id,
                    MAX_DOWNLOAD_SIZE_BYTES
                );
            }

            file.write_all(&chunk).await.with_context(|| {
                format!("Failed to write temp model file {}", temp_path.display())
            })?;

            let percent = if total_bytes == 0 {
                0.0
            } else {
                (downloaded_bytes as f32 / total_bytes as f32) * 100.0
            };

            emit_progress(ModelDownloadProgress {
                model_id: spec.id.to_string(),
                downloaded_bytes,
                total_bytes,
                percent,
            });
        }

        file.flush()
            .await
            .with_context(|| format!("Failed to flush temp model file {}", temp_path.display()))?;
        drop(file);

        tokio::fs::rename(&temp_path, &final_path)
            .await
            .with_context(|| format!("Failed to finalize model file {}", final_path.display()))?;

        if let Err(error) = self.validate_model(spec.id, &final_path) {
            let _ = tokio::fs::remove_file(&final_path).await;
            return Err(error);
        }

        Ok(final_path)
    }

    fn build_model_info(&self, spec: &ModelSpec) -> ModelInfo {
        ModelInfo {
            id: spec.id.to_string(),
            name: spec.name.to_string(),
            size_bytes: spec.size_bytes,
            is_english_only: spec.is_english_only,
            is_downloaded: self.is_model_available(spec.id),
            download_url: spec.url.to_string(),
        }
    }

    fn find_spec(model_id: &str) -> Option<&'static ModelSpec> {
        MODEL_CATALOG
            .iter()
            .find(|candidate| candidate.id == model_id)
    }
}
