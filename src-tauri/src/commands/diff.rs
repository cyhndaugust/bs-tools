use serde::Serialize;
use similar::{ChangeTag, TextDiff};

#[derive(Debug, Serialize)]
pub struct DiffLine {
    pub tag: String,
    pub old_line_no: Option<usize>,
    pub new_line_no: Option<usize>,
    pub content: String,
}

#[derive(Debug, Serialize)]
pub struct DiffStats {
    pub insertions: usize,
    pub deletions: usize,
    pub total_old: usize,
    pub total_new: usize,
}

#[derive(Debug, Serialize)]
pub struct DiffResult {
    pub changes: Vec<DiffLine>,
    pub stats: DiffStats,
}

#[tauri::command]
pub fn compute_diff(old_text: String, new_text: String) -> DiffResult {
    let diff = TextDiff::from_lines(&old_text, &new_text);

    let mut changes = Vec::new();
    let mut insertions = 0usize;
    let mut deletions = 0usize;
    let mut old_line = 1usize;
    let mut new_line = 1usize;

    for change in diff.iter_all_changes() {
        let (tag_str, old_no, new_no) = match change.tag() {
            ChangeTag::Equal => {
                let result = ("equal", Some(old_line), Some(new_line));
                old_line += 1;
                new_line += 1;
                result
            }
            ChangeTag::Insert => {
                insertions += 1;
                let result = ("insert", None, Some(new_line));
                new_line += 1;
                result
            }
            ChangeTag::Delete => {
                deletions += 1;
                let result = ("delete", Some(old_line), None);
                old_line += 1;
                result
            }
        };

        changes.push(DiffLine {
            tag: tag_str.to_string(),
            old_line_no: old_no,
            new_line_no: new_no,
            content: change.to_string_lossy().to_string(),
        });
    }

    let total_old = old_text.lines().count();
    let total_new = new_text.lines().count();

    DiffResult {
        changes,
        stats: DiffStats {
            insertions,
            deletions,
            total_old,
            total_new,
        },
    }
}
