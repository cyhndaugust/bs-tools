import { useState, useMemo } from "react";
import { Button, Collapse, Table, Input, Typography, message, Space, Spin, Tag } from "antd";
import { UploadOutlined, SearchOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import "./MenuParser.css";

const { Text } = Typography;
const { TextArea } = Input;

interface MenuItem {
  show_name_cn: string;
  menu_flag: string;
  menu_flag_type: string;
  link_id: string;
  disabled_status: string;
}

interface SubCategory {
  class_id: string;
  name_cn: string;
  items: MenuItem[];
}

interface ParsedCategory {
  class_id: string;
  name_cn: string;
  sub_categories: SubCategory[];
}

const columns = [
  {
    title: "产品名",
    dataIndex: "show_name_cn",
    key: "show_name_cn",
    ellipsis: true,
  },
  {
    title: "类型 (menuFlag)",
    dataIndex: "menu_flag",
    key: "menu_flag",
    width: 120,
    render: (val: string) => val ? <Tag color="blue">{val}</Tag> : "-",
  },
  {
    title: "menuFlagType",
    dataIndex: "menu_flag_type",
    key: "menu_flag_type",
    width: 120,
    render: (val: string) => val || "-",
  },
  {
    title: "linkId",
    dataIndex: "link_id",
    key: "link_id",
    width: 140,
    ellipsis: true,
  },
  {
    title: "状态",
    dataIndex: "disabled_status",
    key: "disabled_status",
    width: 80,
    render: (val: string) =>
      val === "1" ? (
        <Tag color="red">不可用</Tag>
      ) : (
        <Tag color="green">可用</Tag>
      ),
  },
];

function MenuParser() {
  const [categories, setCategories] = useState<ParsedCategory[]>([]);
  const [loading, setLoading] = useState(false);
  const [totalItems, setTotalItems] = useState(0);
  const [searchKeyword, setSearchKeyword] = useState("");
  const [jsonText, setJsonText] = useState("");
  const [source, setSource] = useState("");

  const filteredCategories = useMemo(() => {
    if (!searchKeyword.trim()) return categories;
    const kw = searchKeyword.toLowerCase();
    return categories
      .map((cat) => ({
        ...cat,
        sub_categories: cat.sub_categories
          .map((sub) => ({
            ...sub,
            items: sub.items.filter(
              (item) =>
                item.show_name_cn.toLowerCase().includes(kw) ||
                item.link_id.toLowerCase().includes(kw),
            ),
          }))
          .filter((sub) => sub.items.length > 0),
      }))
      .filter((cat) => cat.sub_categories.length > 0);
  }, [categories, searchKeyword]);

  const filteredTotal = useMemo(() => {
    return filteredCategories.reduce(
      (sum, cat) =>
        sum + cat.sub_categories.reduce((s, sub) => s + sub.items.length, 0),
      0,
    );
  }, [filteredCategories]);

  function applyResult(result: ParsedCategory[], sourceName: string) {
    setCategories(result);
    setSource(sourceName);
    setSearchKeyword("");
    const total = result.reduce(
      (sum, cat) =>
        sum + cat.sub_categories.reduce((s, sub) => s + sub.items.length, 0),
      0,
    );
    setTotalItems(total);
    message.success(`解析完成，共 ${result.length} 个分类，${total} 个餐品`);
  }

  async function handleParseText() {
    if (!jsonText.trim()) {
      message.warning("请输入 JSON 内容");
      return;
    }
    setLoading(true);
    try {
      const result = await invoke<ParsedCategory[]>("parse_menu_json", {
        jsonContent: jsonText,
      });
      applyResult(result, "文本输入");
    } catch (e) {
      message.error(`解析失败: ${e}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleLoadFile() {
    setLoading(true);
    try {
      const selected = await open({
        filters: [{ name: "JSON", extensions: ["json"] }],
        multiple: false,
      });
      if (!selected) {
        setLoading(false);
        return;
      }
      const filePath = selected as string;
      const content = await readTextFile(filePath);
      setJsonText(content);
      const result = await invoke<ParsedCategory[]>("parse_menu_json", {
        jsonContent: content,
      });
      applyResult(result, filePath.split("/").pop() || filePath);
    } catch (e) {
      message.error(`解析失败: ${e}`);
    } finally {
      setLoading(false);
    }
  }

  const collapseItems = filteredCategories.map((cat) => ({
    key: cat.class_id,
    label: (
      <span>
        <Text strong>{cat.name_cn}</Text>
        <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
          classId: {cat.class_id}
        </Text>
        <Tag style={{ marginLeft: 8 }}>
          {cat.sub_categories.reduce((s, sub) => s + sub.items.length, 0)} 项
        </Tag>
      </span>
    ),
    children:
      cat.sub_categories.length === 1 &&
      cat.sub_categories[0].class_id === cat.class_id ? (
        <Table
          columns={columns}
          dataSource={cat.sub_categories[0].items}
          rowKey={(_, index) => `${cat.class_id}-${index}`}
          size="small"
          pagination={false}
        />
      ) : (
        <Collapse
          size="small"
          items={cat.sub_categories.map((sub) => ({
            key: sub.class_id,
            label: (
              <span>
                <Text>{sub.name_cn}</Text>
                <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                  classId: {sub.class_id}
                </Text>
                <Tag style={{ marginLeft: 8 }}>{sub.items.length} 项</Tag>
              </span>
            ),
            children: (
              <Table
                columns={columns}
                dataSource={sub.items}
                rowKey={(_, index) => `${sub.class_id}-${index}`}
                size="small"
                pagination={false}
              />
            ),
          }))}
        />
      ),
  }));

  return (
    <div className="menu-parser-page">
      <div className="menu-parser-input">
        <TextArea
          value={jsonText}
          onChange={(e) => setJsonText(e.target.value)}
          placeholder="粘贴菜单 JSON 数据..."
          rows={6}
          style={{ fontFamily: "monospace", fontSize: 12 }}
        />
        <div className="menu-parser-actions">
          <Space>
            <Button
              type="primary"
              icon={<ThunderboltOutlined />}
              onClick={handleParseText}
              loading={loading}
            >
              解析
            </Button>
            <Button
              icon={<UploadOutlined />}
              onClick={handleLoadFile}
              loading={loading}
            >
              从文件加载
            </Button>
            {categories.length > 0 && (
              <Input
                placeholder="搜索餐品名或 linkId..."
                prefix={<SearchOutlined style={{ color: "#bbb" }} />}
                allowClear
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                style={{ width: 260 }}
              />
            )}
          </Space>
          {source && (
            <div className="menu-parser-stats">
              <Text type="secondary">
                来源: {source} | 分类: {categories.length} | 餐品: {totalItems}
              </Text>
              {searchKeyword && (
                <Text type="secondary"> | 匹配: {filteredTotal} 项</Text>
              )}
            </div>
          )}
        </div>
      </div>

      <Spin spinning={loading}>
        {categories.length === 0 ? (
          <div className="menu-parser-empty">
            <Text type="secondary">请粘贴或加载菜单 JSON 数据进行解析</Text>
          </div>
        ) : filteredCategories.length === 0 ? (
          <div className="menu-parser-empty">
            <Text type="secondary">无匹配结果</Text>
          </div>
        ) : (
          <Collapse
            items={collapseItems}
            className="menu-parser-collapse"
          />
        )}
      </Spin>
    </div>
  );
}

export default MenuParser;
