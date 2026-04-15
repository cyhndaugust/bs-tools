import { useState } from "react";
import { Radio, Input, Button, Space, Typography, message, Spin, Tag } from "antd";
import { FileSearchOutlined, SwapOutlined } from "@ant-design/icons";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import "./DiffTool.css";

const { TextArea } = Input;
const { Text } = Typography;

interface DiffLine {
  tag: string;
  old_line_no: number | null;
  new_line_no: number | null;
  content: string;
}

interface DiffStats {
  insertions: number;
  deletions: number;
  total_old: number;
  total_new: number;
}

interface DiffResult {
  changes: DiffLine[];
  stats: DiffStats;
}

type InputMode = "text" | "file";

function DiffTool() {
  const [mode, setMode] = useState<InputMode>("text");
  const [oldText, setOldText] = useState("");
  const [newText, setNewText] = useState("");
  const [oldFile, setOldFile] = useState("");
  const [newFile, setNewFile] = useState("");
  const [result, setResult] = useState<DiffResult | null>(null);
  const [loading, setLoading] = useState(false);

  async function selectFile(side: "old" | "new") {
    try {
      const selected = await open({ multiple: false });
      if (!selected) return;
      const path = selected as string;
      const content = await readTextFile(path);
      if (side === "old") {
        setOldText(content);
        setOldFile(path.split("/").pop() || path);
      } else {
        setNewText(content);
        setNewFile(path.split("/").pop() || path);
      }
    } catch (e) {
      message.error(`读取文件失败: ${e}`);
    }
  }

  async function handleCompare() {
    if (!oldText && !newText) {
      message.warning("请输入内容或选择文件");
      return;
    }
    setLoading(true);
    try {
      const res = await invoke<DiffResult>("compute_diff", {
        oldText,
        newText,
      });
      setResult(res);
    } catch (e) {
      message.error(`对比失败: ${e}`);
    } finally {
      setLoading(false);
    }
  }

  function renderDiffLines() {
    if (!result) return null;

    return (
      <div className="diff-lines">
        {result.changes.map((line, idx) => {
          let className = "diff-line";
          let prefix = " ";
          if (line.tag === "insert") {
            className += " diff-insert";
            prefix = "+";
          } else if (line.tag === "delete") {
            className += " diff-delete";
            prefix = "-";
          }

          return (
            <div key={idx} className={className}>
              <span className="diff-line-no diff-line-no-old">
                {line.old_line_no ?? ""}
              </span>
              <span className="diff-line-no diff-line-no-new">
                {line.new_line_no ?? ""}
              </span>
              <span className="diff-prefix">{prefix}</span>
              <span className="diff-content">
                {line.content || "\n"}
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="diff-page">
      <div className="diff-controls">
        <Space>
          <Radio.Group
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            optionType="button"
            buttonStyle="solid"
          >
            <Radio.Button value="text">文本输入</Radio.Button>
            <Radio.Button value="file">文件选择</Radio.Button>
          </Radio.Group>
          <Button
            type="primary"
            icon={<SwapOutlined />}
            onClick={handleCompare}
            loading={loading}
          >
            对比
          </Button>
        </Space>
      </div>

      <div className="diff-inputs">
        <div className="diff-input-panel">
          <div className="diff-input-header">
            <Text strong>原始内容</Text>
            {mode === "file" && (
              <Button
                size="small"
                icon={<FileSearchOutlined />}
                onClick={() => selectFile("old")}
              >
                {oldFile || "选择文件"}
              </Button>
            )}
          </div>
          <TextArea
            value={oldText}
            onChange={(e) => setOldText(e.target.value)}
            placeholder={mode === "text" ? "输入原始文本..." : "选择文件后内容会显示在这里"}
            rows={8}
            readOnly={mode === "file"}
          />
        </div>
        <div className="diff-input-panel">
          <div className="diff-input-header">
            <Text strong>新内容</Text>
            {mode === "file" && (
              <Button
                size="small"
                icon={<FileSearchOutlined />}
                onClick={() => selectFile("new")}
              >
                {newFile || "选择文件"}
              </Button>
            )}
          </div>
          <TextArea
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            placeholder={mode === "text" ? "输入新文本..." : "选择文件后内容会显示在这里"}
            rows={8}
            readOnly={mode === "file"}
          />
        </div>
      </div>

      {result && (
        <div className="diff-result">
          <div className="diff-stats">
            <Tag color="green">+{result.stats.insertions} 新增</Tag>
            <Tag color="red">-{result.stats.deletions} 删除</Tag>
            <Text type="secondary" style={{ marginLeft: 8 }}>
              原始: {result.stats.total_old} 行 | 新: {result.stats.total_new} 行
            </Text>
          </div>
          <Spin spinning={loading}>{renderDiffLines()}</Spin>
        </div>
      )}
    </div>
  );
}

export default DiffTool;
