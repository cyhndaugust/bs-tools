use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
struct RawCategory {
    #[serde(rename = "classId", default)]
    class_id: Option<String>,
    #[serde(rename = "nameCn", default)]
    name_cn: Option<String>,
    #[serde(rename = "menuList", default)]
    menu_list: Option<Vec<RawMenuItem>>,
    #[serde(rename = "childClassList", default)]
    child_class_list: Option<Vec<RawChildClass>>,
}

#[derive(Debug, Deserialize)]
struct RawChildClass {
    #[serde(rename = "classId", default)]
    class_id: Option<String>,
    #[serde(rename = "nameCn", default)]
    name_cn: Option<String>,
    #[serde(rename = "menuList", default)]
    menu_list: Option<Vec<RawMenuItem>>,
}

#[derive(Debug, Deserialize)]
struct RawMenuItem {
    #[serde(rename = "showNameCn", default)]
    show_name_cn: Option<String>,
    #[serde(rename = "menuFlag", default)]
    menu_flag: Option<String>,
    #[serde(rename = "menuFlagType", default)]
    menu_flag_type: Option<String>,
    #[serde(rename = "linkId", default)]
    link_id: Option<String>,
    #[serde(rename = "disabledStatus", default)]
    disabled_status: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ParsedCategory {
    pub class_id: String,
    pub name_cn: String,
    pub sub_categories: Vec<SubCategory>,
}

#[derive(Debug, Serialize)]
pub struct SubCategory {
    pub class_id: String,
    pub name_cn: String,
    pub items: Vec<MenuItem>,
}

#[derive(Debug, Serialize)]
pub struct MenuItem {
    pub show_name_cn: String,
    pub menu_flag: String,
    pub menu_flag_type: String,
    pub link_id: String,
    pub disabled_status: String,
}

fn convert_menu_items(raw_items: &[RawMenuItem]) -> Vec<MenuItem> {
    raw_items
        .iter()
        .map(|item| MenuItem {
            show_name_cn: item.show_name_cn.clone().unwrap_or_default(),
            menu_flag: item.menu_flag.clone().unwrap_or_default(),
            menu_flag_type: item.menu_flag_type.clone().unwrap_or_default(),
            link_id: item.link_id.clone().unwrap_or_default(),
            disabled_status: item.disabled_status.clone().unwrap_or_default(),
        })
        .collect()
}

#[tauri::command]
pub fn parse_menu_json(json_content: String) -> Result<Vec<ParsedCategory>, String> {
    let raw_categories: Vec<RawCategory> =
        serde_json::from_str(&json_content).map_err(|e| format!("JSON 解析失败: {}", e))?;

    let mut result: Vec<ParsedCategory> = Vec::new();

    for cat in &raw_categories {
        let class_id = cat.class_id.clone().unwrap_or_default();
        let name_cn = cat.name_cn.clone().unwrap_or_default();

        if class_id.is_empty() && name_cn.is_empty() {
            continue;
        }

        let sub_categories = if let Some(children) = &cat.child_class_list {
            children
                .iter()
                .map(|child| SubCategory {
                    class_id: child.class_id.clone().unwrap_or_default(),
                    name_cn: child.name_cn.clone().unwrap_or_default(),
                    items: convert_menu_items(
                        child.menu_list.as_deref().unwrap_or_default(),
                    ),
                })
                .collect()
        } else if let Some(menu_list) = &cat.menu_list {
            vec![SubCategory {
                class_id: class_id.clone(),
                name_cn: name_cn.clone(),
                items: convert_menu_items(menu_list),
            }]
        } else {
            continue;
        };

        if sub_categories.iter().all(|s| s.items.is_empty()) {
            continue;
        }

        result.push(ParsedCategory {
            class_id,
            name_cn,
            sub_categories,
        });
    }

    Ok(result)
}
