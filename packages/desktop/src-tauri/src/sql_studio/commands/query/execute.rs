use std::time::Instant;

use crate::commands::observability::{
    CommandResult, SerializableCommandError, unexpected_command_result,
};
use rusqlite::Connection;
use sea_orm::DbConn;
use sqlx::mysql::MySqlRow;
use sqlx::postgres::PgRow;
use sqlx::Column;
use sqlx::Row;
use tauri::State;

use crate::db::repository::SqlStudioRepository;

use super::super::super::types::{
    ExecuteQueryRequest, ExecuteQueryResponse, QueryExecutionMessage, TabularResult,
};
use super::super::helpers::{
    classify_mutating_sql, connect_mysql, connect_postgres, get_sqlite_file_path,
    mysql_cell_to_string, pg_cell_to_string, sqlite_value_to_string,
};

#[tauri::command]
#[specta::specta]
pub async fn sql_studio_execute_query(
    db: State<'_, DbConn>,
    request: ExecuteQueryRequest,
) -> CommandResult<ExecuteQueryResponse> {
    let connection = unexpected_command_result(
        "sql_studio_execute_query",
        "Failed to load SQL connection",
        SqlStudioRepository::get_connection(&db, &request.connection_id)
            .await
            .map_err(|e| format!("Failed to load SQL connection: {}", e)),
    )?
    .ok_or_else(|| {
        SerializableCommandError::expected(
            "sql_studio_execute_query",
            format!("Connection not found: {}", request.connection_id),
        )
    })?;

    let is_mutating = classify_mutating_sql(&request.sql);

    let start = Instant::now();
    let connection_id_for_history = request.connection_id.clone();
    let sql_for_history = request.sql.clone();

    let execution_result: Result<ExecuteQueryResponse, String> = async {
        match connection.engine.as_str() {
            "sqlite" => {
                // Security: SQL Studio runs user-provided SQL and uses the user-configured DB path.
                // This is an intentional power-user feature; only expose to trusted users.
                let file_path = get_sqlite_file_path(&connection)?;
                let conn = Connection::open(file_path)
                    .map_err(|e| format!("Failed to open SQLite connection: {}", e))?;

                if is_mutating {
                    conn.execute_batch(&request.sql)
                        .map_err(|e| format!("Failed to execute mutating SQLite SQL: {}", e))?;

                    let row_count = conn.changes() as i64;
                    Ok(ExecuteQueryResponse {
                        duration_ms: start.elapsed().as_millis() as i64,
                        row_count,
                        result: None,
                        messages: vec![QueryExecutionMessage {
                            level: "info".to_string(),
                            text: format!("Statement executed. Rows affected: {}", row_count),
                        }],
                    })
                } else {
                    let mut stmt = conn
                        .prepare(&request.sql)
                        .map_err(|e| format!("Failed to prepare SQLite query: {}", e))?;

                    let columns = stmt
                        .column_names()
                        .iter()
                        .map(|name| (*name).to_string())
                        .collect::<Vec<_>>();

                    let mut rows_cursor = stmt
                        .query([])
                        .map_err(|e| format!("Failed to execute SQLite query: {}", e))?;

                    let mut rows = Vec::new();
                    while let Some(row) = rows_cursor
                        .next()
                        .map_err(|e| format!("Failed reading SQLite query rows: {}", e))?
                    {
                        let current_row = (0..columns.len())
                            .map(|idx| {
                                row.get_ref(idx)
                                    .map(sqlite_value_to_string)
                                    .map_err(|e| format!("Failed reading SQLite column {}: {}", idx, e))
                            })
                            .collect::<Result<Vec<_>, String>>()?;
                        rows.push(current_row);
                    }

                    let row_count = rows.len() as i64;
                    Ok(ExecuteQueryResponse {
                        duration_ms: start.elapsed().as_millis() as i64,
                        row_count,
                        result: Some(TabularResult { columns, rows }),
                        messages: vec![QueryExecutionMessage {
                            level: "info".to_string(),
                            text: format!("Query completed with {} rows", row_count),
                        }],
                    })
                }
            }
            "postgres" => {
                let pool = connect_postgres(&connection).await?;

                let response: Result<ExecuteQueryResponse, String> = if is_mutating {
                    let result = sqlx::query(&request.sql)
                        .execute(&pool)
                        .await
                        .map_err(|e| format!("Failed to execute mutating Postgres SQL: {}", e))?;
                    let row_count = result.rows_affected() as i64;
                    Ok(ExecuteQueryResponse {
                        duration_ms: start.elapsed().as_millis() as i64,
                        row_count,
                        result: None,
                        messages: vec![QueryExecutionMessage {
                            level: "info".to_string(),
                            text: format!("Statement executed. Rows affected: {}", row_count),
                        }],
                    })
                } else {
                    let rows = sqlx::query(&request.sql)
                        .fetch_all(&pool)
                        .await
                        .map_err(|e| format!("Failed to execute Postgres query: {}", e))?;

                    let columns = rows
                        .first()
                        .map(|row: &PgRow| {
                            row.columns()
                                .iter()
                                .map(|col| col.name().to_string())
                                .collect::<Vec<_>>()
                        })
                        .unwrap_or_default();

                    let mapped_rows = rows
                        .iter()
                        .map(|row| {
                            (0..columns.len())
                                .map(|idx| pg_cell_to_string(row, idx))
                                .collect::<Vec<_>>()
                        })
                        .collect::<Vec<_>>();

                    let row_count = mapped_rows.len() as i64;
                    Ok(ExecuteQueryResponse {
                        duration_ms: start.elapsed().as_millis() as i64,
                        row_count,
                        result: Some(TabularResult {
                            columns,
                            rows: mapped_rows,
                        }),
                        messages: vec![QueryExecutionMessage {
                            level: "info".to_string(),
                            text: format!("Query completed with {} rows", row_count),
                        }],
                    })
                };

                pool.close().await;
                response
            }
            "mysql" => {
                let pool = connect_mysql(&connection).await?;

                let response: Result<ExecuteQueryResponse, String> = if is_mutating {
                    let result = sqlx::query(&request.sql)
                        .execute(&pool)
                        .await
                        .map_err(|e| format!("Failed to execute mutating MySQL SQL: {}", e))?;
                    let row_count = result.rows_affected() as i64;
                    Ok(ExecuteQueryResponse {
                        duration_ms: start.elapsed().as_millis() as i64,
                        row_count,
                        result: None,
                        messages: vec![QueryExecutionMessage {
                            level: "info".to_string(),
                            text: format!("Statement executed. Rows affected: {}", row_count),
                        }],
                    })
                } else {
                    let rows = sqlx::query(&request.sql)
                        .fetch_all(&pool)
                        .await
                        .map_err(|e| format!("Failed to execute MySQL query: {}", e))?;

                    let columns = rows
                        .first()
                        .map(|row: &MySqlRow| {
                            row.columns()
                                .iter()
                                .map(|col| col.name().to_string())
                                .collect::<Vec<_>>()
                        })
                        .unwrap_or_default();

                    let mapped_rows = rows
                        .iter()
                        .map(|row| {
                            (0..columns.len())
                                .map(|idx| mysql_cell_to_string(row, idx))
                                .collect::<Vec<_>>()
                        })
                        .collect::<Vec<_>>();

                    let row_count = mapped_rows.len() as i64;
                    Ok(ExecuteQueryResponse {
                        duration_ms: start.elapsed().as_millis() as i64,
                        row_count,
                        result: Some(TabularResult {
                            columns,
                            rows: mapped_rows,
                        }),
                        messages: vec![QueryExecutionMessage {
                            level: "info".to_string(),
                            text: format!("Query completed with {} rows", row_count),
                        }],
                    })
                };

                pool.close().await;
                response
            }
            engine => Err(format!("Unsupported database engine: {}", engine)),
        }
    }
    .await;

    match execution_result {
        Ok(execution) => {
            let history_insert = SqlStudioRepository::insert_query_history(
                &db,
                connection_id_for_history,
                sql_for_history,
                execution.duration_ms,
                execution.row_count,
                "ok".to_string(),
                None,
            )
            .await;

            if let Err(e) = history_insert {
                tracing::warn!(error = %e, "Failed to write SQL query history");
            }

            Ok(execution)
        }
        Err(error_message) => {
            let summary = error_message.chars().take(500).collect::<String>();
            let history_insert = SqlStudioRepository::insert_query_history(
                &db,
                connection_id_for_history,
                sql_for_history,
                start.elapsed().as_millis() as i64,
                0,
                "error".to_string(),
                Some(summary),
            )
            .await;

            if let Err(e) = history_insert {
                tracing::warn!(error = %e, "Failed to write failed SQL query history");
            }

            Err(SerializableCommandError::expected(
                "sql_studio_execute_query",
                error_message,
            ))
        }
    }
}
