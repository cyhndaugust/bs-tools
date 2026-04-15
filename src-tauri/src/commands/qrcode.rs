use crate::db::DbState;
use qrcode::render::svg;
use qrcode::QrCode;
use serde::Serialize;
use tauri::State;

#[derive(Debug, Serialize)]
pub struct QrCodeResult {
    pub id: i64,
    pub content: String,
    pub svg: String,
    pub created_at: String,
}

#[tauri::command]
pub fn generate_qrcode(
    content: String,
    db: State<'_, DbState>,
) -> Result<QrCodeResult, String> {
    if content.trim().is_empty() {
        return Err("内容不能为空".to_string());
    }

    let code = QrCode::new(content.as_bytes()).map_err(|e| format!("生成二维码失败: {}", e))?;
    let svg_string = code
        .render::<svg::Color>()
        .min_dimensions(256, 256)
        .quiet_zone(true)
        .build();

    let conn = db.0.lock().map_err(|e| format!("数据库锁定失败: {}", e))?;
    conn.execute(
        "INSERT INTO qr_history (content, svg) VALUES (?1, ?2)",
        rusqlite::params![content, svg_string],
    )
    .map_err(|e| format!("保存历史失败: {}", e))?;

    let id = conn.last_insert_rowid();
    let created_at: String = conn
        .query_row(
            "SELECT created_at FROM qr_history WHERE id = ?1",
            [id],
            |row| row.get(0),
        )
        .map_err(|e| format!("查询失败: {}", e))?;

    Ok(QrCodeResult {
        id,
        content,
        svg: svg_string,
        created_at,
    })
}

#[tauri::command]
pub fn get_qr_history(db: State<'_, DbState>) -> Result<Vec<QrCodeResult>, String> {
    let conn = db.0.lock().map_err(|e| format!("数据库锁定失败: {}", e))?;
    let mut stmt = conn
        .prepare("SELECT id, content, svg, created_at FROM qr_history ORDER BY created_at DESC")
        .map_err(|e| format!("查询失败: {}", e))?;

    let results = stmt
        .query_map([], |row| {
            Ok(QrCodeResult {
                id: row.get(0)?,
                content: row.get(1)?,
                svg: row.get(2)?,
                created_at: row.get(3)?,
            })
        })
        .map_err(|e| format!("查询失败: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("读取数据失败: {}", e))?;

    Ok(results)
}

#[tauri::command]
pub fn delete_qr_history(id: i64, db: State<'_, DbState>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| format!("数据库锁定失败: {}", e))?;
    conn.execute("DELETE FROM qr_history WHERE id = ?1", [id])
        .map_err(|e| format!("删除失败: {}", e))?;
    Ok(())
}
