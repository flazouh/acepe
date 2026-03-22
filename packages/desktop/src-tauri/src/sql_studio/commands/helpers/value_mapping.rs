use chrono::{DateTime, FixedOffset, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use rusqlite::types::ValueRef;
use sqlx::mysql::MySqlRow;
use sqlx::postgres::PgRow;
use sqlx::Row;

pub(crate) fn sqlite_value_to_string(value: ValueRef<'_>) -> String {
    match value {
        ValueRef::Null => "NULL".to_string(),
        ValueRef::Integer(v) => v.to_string(),
        ValueRef::Real(v) => v.to_string(),
        ValueRef::Text(v) => String::from_utf8_lossy(v).to_string(),
        ValueRef::Blob(_) => "<BLOB>".to_string(),
    }
}

pub(crate) fn pg_cell_to_string(row: &PgRow, idx: usize) -> String {
    if let Ok(value) = row.try_get::<Option<String>, _>(idx) {
        return value.unwrap_or_else(|| "NULL".to_string());
    }
    if let Ok(value) = row.try_get::<Option<i64>, _>(idx) {
        return value.map_or_else(|| "NULL".to_string(), |v| v.to_string());
    }
    if let Ok(value) = row.try_get::<Option<i32>, _>(idx) {
        return value.map_or_else(|| "NULL".to_string(), |v| v.to_string());
    }
    if let Ok(value) = row.try_get::<Option<f64>, _>(idx) {
        return value.map_or_else(|| "NULL".to_string(), |v| v.to_string());
    }
    if let Ok(value) = row.try_get::<Option<bool>, _>(idx) {
        return value.map_or_else(|| "NULL".to_string(), |v| v.to_string());
    }
    if let Ok(value) = row.try_get::<Option<serde_json::Value>, _>(idx) {
        return value.map_or_else(|| "NULL".to_string(), |v| v.to_string());
    }
    if let Ok(value) = row.try_get::<Option<Vec<u8>>, _>(idx) {
        return value.map_or_else(|| "NULL".to_string(), |v| format!("0x{}", hex::encode(v)));
    }
    if let Ok(value) = row.try_get::<Option<NaiveDateTime>, _>(idx) {
        return value.map_or_else(|| "NULL".to_string(), |v| v.to_string());
    }
    if let Ok(value) = row.try_get::<Option<DateTime<Utc>>, _>(idx) {
        return value.map_or_else(|| "NULL".to_string(), |v| v.to_rfc3339());
    }
    if let Ok(value) = row.try_get::<Option<DateTime<FixedOffset>>, _>(idx) {
        return value.map_or_else(|| "NULL".to_string(), |v| v.to_rfc3339());
    }
    if let Ok(value) = row.try_get::<Option<NaiveDate>, _>(idx) {
        return value.map_or_else(|| "NULL".to_string(), |v| v.to_string());
    }
    if let Ok(value) = row.try_get::<Option<NaiveTime>, _>(idx) {
        return value.map_or_else(|| "NULL".to_string(), |v| v.to_string());
    }

    "<UNSUPPORTED>".to_string()
}

pub(crate) fn mysql_cell_to_string(row: &MySqlRow, idx: usize) -> String {
    if let Ok(value) = row.try_get::<Option<String>, _>(idx) {
        return value.unwrap_or_else(|| "NULL".to_string());
    }
    if let Ok(value) = row.try_get::<Option<i64>, _>(idx) {
        return value.map_or_else(|| "NULL".to_string(), |v| v.to_string());
    }
    if let Ok(value) = row.try_get::<Option<i32>, _>(idx) {
        return value.map_or_else(|| "NULL".to_string(), |v| v.to_string());
    }
    if let Ok(value) = row.try_get::<Option<f64>, _>(idx) {
        return value.map_or_else(|| "NULL".to_string(), |v| v.to_string());
    }
    if let Ok(value) = row.try_get::<Option<bool>, _>(idx) {
        return value.map_or_else(|| "NULL".to_string(), |v| v.to_string());
    }
    if let Ok(value) = row.try_get::<Option<serde_json::Value>, _>(idx) {
        return value.map_or_else(|| "NULL".to_string(), |v| v.to_string());
    }
    if let Ok(value) = row.try_get::<Option<Vec<u8>>, _>(idx) {
        return value.map_or_else(|| "NULL".to_string(), |v| format!("0x{}", hex::encode(v)));
    }
    if let Ok(value) = row.try_get::<Option<NaiveDateTime>, _>(idx) {
        return value.map_or_else(|| "NULL".to_string(), |v| v.to_string());
    }
    if let Ok(value) = row.try_get::<Option<NaiveDate>, _>(idx) {
        return value.map_or_else(|| "NULL".to_string(), |v| v.to_string());
    }
    if let Ok(value) = row.try_get::<Option<NaiveTime>, _>(idx) {
        return value.map_or_else(|| "NULL".to_string(), |v| v.to_string());
    }

    "<UNSUPPORTED>".to_string()
}

pub(crate) fn previewable_content_type(content_type: &str) -> bool {
    let normalized = content_type.trim().to_ascii_lowercase();
    normalized.starts_with("text/")
        || normalized == "application/json"
        || normalized.ends_with("+json")
        || normalized == "application/xml"
        || normalized == "text/xml"
}
