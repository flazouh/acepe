use rusqlite::{params_from_iter, types::Value, Connection};
use sea_orm::DbConn;
use tauri::State;

use crate::db::repository::SqlStudioRepository;

use super::super::super::types::{UpdateTableCellRequest, UpdateTableCellResponse};
use super::super::helpers::{
    build_qualified_table_name, connect_mysql, connect_postgres, get_sqlite_file_path,
    quote_ident_backtick, quote_ident_double, require_field,
};

#[tauri::command]
#[specta::specta]
pub async fn sql_studio_update_table_cell(
    db: State<'_, DbConn>,
    request: UpdateTableCellRequest,
) -> Result<UpdateTableCellResponse, String> {
    if request.primary_key_columns.is_empty() {
        return Err("Cannot edit rows for tables without a primary key".to_string());
    }

    if request.primary_key_columns.len() != request.primary_key_values.len() {
        return Err("Primary key columns and values length mismatch".to_string());
    }

    let connection = SqlStudioRepository::get_connection(&db, &request.connection_id)
        .await
        .map_err(|e| format!("Failed to load SQL connection: {}", e))?
        .ok_or_else(|| format!("Connection not found: {}", request.connection_id))?;

    match connection.engine.as_str() {
        "sqlite" => {
            let file_path = get_sqlite_file_path(&connection)?;
            let conn = Connection::open(file_path)
                .map_err(|e| format!("Failed to open SQLite connection: {}", e))?;
            let qualified_table =
                build_qualified_table_name("sqlite", &request.schema_name, &request.table_name);
            let set_column = quote_ident_double(&request.column_name);
            let where_clause = request
                .primary_key_columns
                .iter()
                .enumerate()
                .map(|(index, pk)| format!("{} = ?{}", quote_ident_double(pk), index + 2))
                .collect::<Vec<_>>()
                .join(" AND ");
            let sql = format!(
                "UPDATE {} SET {} = ?1 WHERE {}",
                qualified_table, set_column, where_clause
            );

            let mut values = Vec::new();
            if let Some(value) = &request.new_value {
                values.push(Value::Text(value.clone()));
            } else {
                values.push(Value::Null);
            }
            values.extend(
                request
                    .primary_key_values
                    .iter()
                    .map(|value| Value::Text(value.clone())),
            );

            let rows_affected = conn
                .execute(&sql, params_from_iter(values))
                .map_err(|e| format!("Failed to update SQLite row: {}", e))?
                as i64;

            if rows_affected != 1 {
                return Err(format!(
                    "Update failed. Expected 1 affected row, got {}",
                    rows_affected
                ));
            }

            Ok(UpdateTableCellResponse { rows_affected })
        }
        "postgres" => {
            let pool = connect_postgres(&connection).await?;
            let qualified_table =
                build_qualified_table_name("postgres", &request.schema_name, &request.table_name);
            let set_column = quote_ident_double(&request.column_name);
            let where_clause = request
                .primary_key_columns
                .iter()
                .enumerate()
                .map(|(index, pk)| format!("{} = ${}", quote_ident_double(pk), index + 2))
                .collect::<Vec<_>>()
                .join(" AND ");
            let sql = format!(
                "UPDATE {} SET {} = $1 WHERE {}",
                qualified_table, set_column, where_clause
            );

            let mut query = sqlx::query(&sql).bind(request.new_value.clone());
            for pk_value in &request.primary_key_values {
                query = query.bind(pk_value.clone());
            }

            let result = query
                .execute(&pool)
                .await
                .map_err(|e| format!("Failed to update Postgres row: {}", e))?;
            pool.close().await;
            let rows_affected = result.rows_affected() as i64;

            if rows_affected != 1 {
                return Err(format!(
                    "Update failed. Expected 1 affected row, got {}",
                    rows_affected
                ));
            }

            Ok(UpdateTableCellResponse { rows_affected })
        }
        "mysql" => {
            let pool = connect_mysql(&connection).await?;
            let schema_name = if request.schema_name.trim().is_empty() {
                require_field(&connection.database_name, "database_name")?
            } else {
                request.schema_name.clone()
            };
            let qualified_table =
                build_qualified_table_name("mysql", &schema_name, &request.table_name);
            let set_column = quote_ident_backtick(&request.column_name);
            let where_clause = request
                .primary_key_columns
                .iter()
                .map(|pk| format!("{} = ?", quote_ident_backtick(pk)))
                .collect::<Vec<_>>()
                .join(" AND ");
            let sql = format!(
                "UPDATE {} SET {} = ? WHERE {}",
                qualified_table, set_column, where_clause
            );

            let mut query = sqlx::query(&sql).bind(request.new_value.clone());
            for pk_value in &request.primary_key_values {
                query = query.bind(pk_value.clone());
            }

            let result = query
                .execute(&pool)
                .await
                .map_err(|e| format!("Failed to update MySQL row: {}", e))?;
            pool.close().await;
            let rows_affected = result.rows_affected() as i64;

            if rows_affected != 1 {
                return Err(format!(
                    "Update failed. Expected 1 affected row, got {}",
                    rows_affected
                ));
            }

            Ok(UpdateTableCellResponse { rows_affected })
        }
        engine => Err(format!("Unsupported database engine: {}", engine)),
    }
}
