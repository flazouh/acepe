use rusqlite::Connection;
use sea_orm::DbConn;
use tauri::State;
use tokio::io::AsyncWriteExt;

use crate::db::repository::{SqlConnectionRow, SqlStudioRepository};

use super::super::types::{
    S3BucketNode, S3DownloadRequest, S3ListObjectsRequest, S3ListObjectsResponse, S3ObjectNode,
    S3PreviewRequest, S3PreviewResponse, TestConnectionResponse,
};
use super::helpers::*;

const S3_PREVIEW_SIZE_LIMIT_BYTES: i64 = 1024 * 1024;

#[tauri::command]
#[specta::specta]
pub async fn sql_studio_list_s3_buckets(
    db: State<'_, DbConn>,
    connection_id: String,
) -> Result<Vec<S3BucketNode>, String> {
    let connection = SqlStudioRepository::get_connection(&db, &connection_id)
        .await
        .map_err(|e| format!("Failed to load SQL connection: {}", e))?
        .ok_or_else(|| format!("Connection not found: {}", connection_id))?;

    if connection.engine != "s3" {
        return Err("Connection is not an S3 data source".to_string());
    }

    let client = connect_s3(&connection).await?;
    let response = client
        .list_buckets()
        .send()
        .await
        .map_err(|e| format!("Failed to list S3 buckets: {}", e))?;

    Ok(response
        .buckets()
        .iter()
        .map(|bucket| S3BucketNode {
            name: bucket.name().unwrap_or_default().to_string(),
            creation_date: bucket.creation_date().map(|v| v.to_string()),
        })
        .collect())
}

#[tauri::command]
#[specta::specta]
pub async fn sql_studio_list_s3_objects(
    db: State<'_, DbConn>,
    request: S3ListObjectsRequest,
) -> Result<S3ListObjectsResponse, String> {
    let connection = SqlStudioRepository::get_connection(&db, &request.connection_id)
        .await
        .map_err(|e| format!("Failed to load SQL connection: {}", e))?
        .ok_or_else(|| format!("Connection not found: {}", request.connection_id))?;

    if connection.engine != "s3" {
        return Err("Connection is not an S3 data source".to_string());
    }

    let client = connect_s3(&connection).await?;
    let mut builder = client
        .list_objects_v2()
        .bucket(request.bucket.clone())
        .delimiter("/")
        .max_keys(request.limit.unwrap_or(200));

    if let Some(prefix) = request
        .prefix
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        builder = builder.prefix(prefix.clone());
    }
    if let Some(token) = request
        .continuation_token
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        builder = builder.continuation_token(token.clone());
    }

    let response = builder
        .send()
        .await
        .map_err(|e| format!("Failed to list S3 objects: {}", e))?;

    let mut objects = Vec::new();
    for prefix in response.common_prefixes() {
        if let Some(value) = prefix.prefix() {
            objects.push(S3ObjectNode {
                key: value.to_string(),
                size: 0,
                last_modified: None,
                storage_class: None,
                is_prefix: true,
            });
        }
    }

    for object in response.contents() {
        let key = object.key().unwrap_or_default().to_string();
        if key.is_empty() {
            continue;
        }
        objects.push(S3ObjectNode {
            key,
            size: object.size().unwrap_or(0),
            last_modified: object.last_modified().map(|v| v.to_string()),
            storage_class: object.storage_class().map(|v| v.as_str().to_string()),
            is_prefix: false,
        });
    }

    Ok(S3ListObjectsResponse {
        bucket: request.bucket,
        prefix: request.prefix.unwrap_or_default(),
        objects,
        next_continuation_token: response.next_continuation_token().map(|v| v.to_string()),
    })
}

#[tauri::command]
#[specta::specta]
pub async fn sql_studio_preview_s3_object(
    db: State<'_, DbConn>,
    request: S3PreviewRequest,
) -> Result<S3PreviewResponse, String> {
    let connection = SqlStudioRepository::get_connection(&db, &request.connection_id)
        .await
        .map_err(|e| format!("Failed to load SQL connection: {}", e))?
        .ok_or_else(|| format!("Connection not found: {}", request.connection_id))?;

    if connection.engine != "s3" {
        return Err("Connection is not an S3 data source".to_string());
    }

    let client = connect_s3(&connection).await?;
    let head = client
        .head_object()
        .bucket(request.bucket.clone())
        .key(request.key.clone())
        .send()
        .await
        .map_err(|e| format!("Failed to inspect S3 object: {}", e))?;

    let content_length = head.content_length().unwrap_or(0);
    let content_type = head.content_type().map(|v| v.to_string());
    if content_length > S3_PREVIEW_SIZE_LIMIT_BYTES {
        return Ok(S3PreviewResponse {
            content: None,
            content_type,
            content_length,
            previewable: false,
            reason: Some(format!(
                "File is larger than {} bytes preview limit",
                S3_PREVIEW_SIZE_LIMIT_BYTES
            )),
        });
    }

    if let Some(content_type_value) = content_type.as_deref() {
        if !previewable_content_type(content_type_value) {
            return Ok(S3PreviewResponse {
                content: None,
                content_type,
                content_length,
                previewable: false,
                reason: Some("Content type is not previewable inline".to_string()),
            });
        }
    }

    let object = client
        .get_object()
        .bucket(request.bucket)
        .key(request.key)
        .send()
        .await
        .map_err(|e| format!("Failed to load S3 object: {}", e))?;

    let bytes = object
        .body
        .collect()
        .await
        .map_err(|e| format!("Failed to read S3 object body: {}", e))?
        .into_bytes();

    let content = String::from_utf8(bytes.to_vec())
        .map_err(|_| "S3 object content is not UTF-8; use download instead".to_string())?;

    Ok(S3PreviewResponse {
        content: Some(content),
        content_type,
        content_length,
        previewable: true,
        reason: None,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn sql_studio_download_s3_object(
    db: State<'_, DbConn>,
    request: S3DownloadRequest,
) -> Result<Option<String>, String> {
    let connection = SqlStudioRepository::get_connection(&db, &request.connection_id)
        .await
        .map_err(|e| format!("Failed to load SQL connection: {}", e))?
        .ok_or_else(|| format!("Connection not found: {}", request.connection_id))?;

    if connection.engine != "s3" {
        return Err("Connection is not an S3 data source".to_string());
    }

    let save_target = rfd::AsyncFileDialog::new()
        .set_title("Save S3 Object")
        .set_file_name(
            request
                .key
                .rsplit('/')
                .next()
                .filter(|v| !v.is_empty())
                .unwrap_or("download.bin"),
        )
        .save_file()
        .await;
    let Some(file_handle) = save_target else {
        return Ok(None);
    };

    let client = connect_s3(&connection).await?;
    let object = client
        .get_object()
        .bucket(request.bucket)
        .key(request.key)
        .send()
        .await
        .map_err(|e| format!("Failed to download S3 object: {}", e))?;

    let bytes = object
        .body
        .collect()
        .await
        .map_err(|e| format!("Failed to stream S3 object body: {}", e))?
        .into_bytes();
    let output_path = file_handle.path().to_path_buf();
    let mut file = tokio::fs::File::create(&output_path)
        .await
        .map_err(|e| format!("Failed to create destination file: {}", e))?;
    file.write_all(&bytes)
        .await
        .map_err(|e| format!("Failed to write destination file: {}", e))?;
    file.flush()
        .await
        .map_err(|e| format!("Failed to flush destination file: {}", e))?;

    Ok(Some(output_path.to_string_lossy().to_string()))
}

async fn test_connection_row(
    connection: &SqlConnectionRow,
) -> Result<TestConnectionResponse, String> {
    match connection.engine.as_str() {
        "sqlite" => {
            let file_path = get_sqlite_file_path(connection)?;
            let conn = Connection::open(file_path)
                .map_err(|e| format!("Failed to open SQLite connection: {}", e))?;
            conn.prepare("SELECT 1")
                .map_err(|e| format!("Failed to run SQLite test query: {}", e))?;
            Ok(TestConnectionResponse {
                ok: true,
                message: "SQLite connection successful".to_string(),
            })
        }
        "postgres" => {
            let pool = connect_postgres(connection).await?;
            sqlx::query("SELECT 1")
                .execute(&pool)
                .await
                .map_err(|e| format!("Failed to run Postgres test query: {}", e))?;
            pool.close().await;
            Ok(TestConnectionResponse {
                ok: true,
                message: "Postgres connection successful".to_string(),
            })
        }
        "mysql" => {
            let pool = connect_mysql(connection).await?;
            sqlx::query("SELECT 1")
                .execute(&pool)
                .await
                .map_err(|e| format!("Failed to run MySQL test query: {}", e))?;
            pool.close().await;
            Ok(TestConnectionResponse {
                ok: true,
                message: "MySQL connection successful".to_string(),
            })
        }
        "s3" => {
            let client = connect_s3(connection).await?;
            client
                .list_buckets()
                .send()
                .await
                .map_err(|e| format!("Failed to list S3 buckets: {}", e))?;
            Ok(TestConnectionResponse {
                ok: true,
                message: "S3 connection successful".to_string(),
            })
        }
        engine => Err(format!("Unsupported database engine: {}", engine)),
    }
}

#[tauri::command]
#[specta::specta]
pub async fn sql_studio_test_connection(
    db: State<'_, DbConn>,
    id: String,
) -> Result<TestConnectionResponse, String> {
    let connection = SqlStudioRepository::get_connection(&db, &id)
        .await
        .map_err(|e| format!("Failed to load SQL connection: {}", e))?
        .ok_or_else(|| format!("Connection not found: {}", id))?;

    test_connection_row(&connection).await
}
