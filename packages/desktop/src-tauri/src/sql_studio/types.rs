use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum DbEngine {
    Postgres,
    Mysql,
    Sqlite,
    S3,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionKind {
    Sql,
    S3,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SqlConnectionSummary {
    pub id: String,
    pub name: String,
    pub engine: DbEngine,
    pub subtitle: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SqlConnectionConfig {
    pub kind: ConnectionKind,
    pub id: Option<String>,
    pub name: String,
    pub engine: DbEngine,
    pub host: Option<String>,
    pub port: Option<i32>,
    pub database_name: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub file_path: Option<String>,
    pub ssl_mode: Option<String>,
    pub s3_region: Option<String>,
    pub s3_endpoint_url: Option<String>,
    pub s3_force_path_style: Option<bool>,
    pub s3_default_prefix: Option<String>,
    pub s3_access_key_id: Option<String>,
    pub s3_secret_access_key: Option<String>,
    pub s3_session_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct TestConnectionResponse {
    pub ok: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ColumnNode {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub is_primary_key: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct TableNode {
    pub name: String,
    pub schema: String,
    pub columns: Vec<ColumnNode>,
    pub primary_key_columns: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SchemaNode {
    pub name: String,
    pub tables: Vec<TableNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteQueryRequest {
    pub connection_id: String,
    pub sql: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ExploreTableRequest {
    pub connection_id: String,
    pub schema_name: String,
    pub table_name: String,
    pub offset: i64,
    pub limit: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ExploreTableResponse {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub next_offset: Option<i64>,
    pub row_count_loaded: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTableCellRequest {
    pub connection_id: String,
    pub schema_name: String,
    pub table_name: String,
    pub primary_key_columns: Vec<String>,
    pub primary_key_values: Vec<String>,
    pub column_name: String,
    pub new_value: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTableCellResponse {
    pub rows_affected: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct QueryExecutionMessage {
    pub level: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct TabularResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteQueryResponse {
    pub duration_ms: i64,
    pub row_count: i64,
    pub result: Option<TabularResult>,
    pub messages: Vec<QueryExecutionMessage>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct S3BucketNode {
    pub name: String,
    pub creation_date: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct S3ObjectNode {
    pub key: String,
    pub size: i64,
    pub last_modified: Option<String>,
    pub storage_class: Option<String>,
    pub is_prefix: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct S3ListObjectsRequest {
    pub connection_id: String,
    pub bucket: String,
    pub prefix: Option<String>,
    pub continuation_token: Option<String>,
    pub limit: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct S3ListObjectsResponse {
    pub bucket: String,
    pub prefix: String,
    pub objects: Vec<S3ObjectNode>,
    pub next_continuation_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct S3PreviewRequest {
    pub connection_id: String,
    pub bucket: String,
    pub key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct S3PreviewResponse {
    pub content: Option<String>,
    pub content_type: Option<String>,
    pub content_length: i64,
    pub previewable: bool,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct S3DownloadRequest {
    pub connection_id: String,
    pub bucket: String,
    pub key: String,
}

impl DbEngine {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Postgres => "postgres",
            Self::Mysql => "mysql",
            Self::Sqlite => "sqlite",
            Self::S3 => "s3",
        }
    }

    pub fn from_db_value(value: &str) -> Option<Self> {
        match value {
            "postgres" => Some(Self::Postgres),
            "mysql" => Some(Self::Mysql),
            "sqlite" => Some(Self::Sqlite),
            "s3" => Some(Self::S3),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::DbEngine;

    #[test]
    fn from_db_value_supports_s3() {
        assert!(DbEngine::from_db_value("s3").is_some());
    }
}
