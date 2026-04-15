import { useState, useMemo } from "react";
import { Radio, Input, Button, Space, Typography, message, Spin, Tag } from "antd";
import { FileSearchOutlined, SwapOutlined } from "@ant-design/icons";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import hljs from "highlight.js";
import "highlight.js/styles/github.css";
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

function detectLanguage(fileName: string): string | undefined {
  const ext = fileName.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript",
    py: "python", rs: "rust", go: "go", java: "java", kt: "kotlin",
    c: "c", cpp: "cpp", h: "c", hpp: "cpp", cs: "csharp",
    rb: "ruby", php: "php", swift: "swift", m: "objectivec",
    html: "xml", htm: "xml", xml: "xml", svg: "xml",
    css: "css", scss: "scss", less: "less",
    json: "json", yaml: "yaml", yml: "yaml", toml: "ini",
    md: "markdown", sql: "sql", sh: "bash", bash: "bash", zsh: "bash",
    dockerfile: "dockerfile", makefile: "makefile", vue: "xml",
  };
  return ext ? map[ext] : undefined;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Highlight full text, then split into lines.
 * This preserves multi-line token context (block comments, strings, etc.).
 * We need to track open <span> tags across line boundaries so each line
 * is independently renderable.
 */
function highlightAndSplit(text: string, lang?: string): string[] {
  if (!text) return [];

  let html: string;
  try {
    if (lang) {
      html = hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
    } else {
      const result = hljs.highlightAuto(text);
      html = result.value;
    }
  } catch {
    html = escapeHtml(text);
  }

  // Split the highlighted HTML by newlines, carrying open spans across lines
  const rawLines = html.split("\n");
  const result: string[] = [];
  let openSpans: string[] = [];

  for (const rawLine of rawLines) {
    // Prepend any spans that were open from previous lines
    let line = openSpans.join("") + rawLine;

    // Track span opens/closes to know what's still open at end of line
    const openMatches = rawLine.match(/<span[^>]*>/g) || [];
    const closeMatches = rawLine.match(/<\/span>/g) || [];

    const netOpens = openMatches.length - closeMatches.length;
    if (netOpens > 0) {
      // More opens than closes — add the last `netOpens` open tags to carry forward
      openSpans.push(...openMatches.slice(openMatches.length - netOpens));
    } else if (netOpens < 0) {
      // More closes than opens — pop from our stack
      openSpans.splice(openSpans.length + netOpens);
    }

    // Close any still-open spans at end of this line for valid HTML
    line += "</span>".repeat(openSpans.length);

    result.push(line);
  }

  return result;
}

function DiffTool() {
  const [mode, setMode] = useState<InputMode>("text");
  const [oldText, setOldText] = useState("");
  const [newText, setNewText] = useState("");
  const [oldFile, setOldFile] = useState("");
  const [newFile, setNewFile] = useState("");
  const [result, setResult] = useState<DiffResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [language, setLanguage] = useState<string | undefined>(undefined);

  // Pre-highlight full old/new text, split into per-line HTML
  const oldHighlightedLines = useMemo(
    () => highlightAndSplit(oldText, language),
    [oldText, language],
  );
  const newHighlightedLines = useMemo(
    () => highlightAndSplit(newText, language),
    [newText, language],
  );

  async function selectFile(side: "old" | "new") {
    try {
      const selected = await open({ multiple: false });
      if (!selected) return;
      const path = selected as string;
      const content = await readTextFile(path);
      const name = path.split("/").pop() || path;
      if (side === "old") {
        setOldText(content);
        setOldFile(name);
      } else {
        setNewText(content);
        setNewFile(name);
      }
      setLanguage(detectLanguage(name));
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
      // Auto-detect language from content if not detected from file name
      if (!language && (oldText || newText)) {
        const sample = oldText || newText;
        const detected = hljs.highlightAuto(sample);
        if (detected.language && detected.relevance > 5) {
          setLanguage(detected.language);
        }
      }
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

          // Map diff line to pre-highlighted HTML
          let highlightedHtml: string;
          if (line.tag === "delete" && line.old_line_no != null) {
            highlightedHtml = oldHighlightedLines[line.old_line_no - 1] ?? escapeHtml(line.content);
          } else if (line.tag === "insert" && line.new_line_no != null) {
            highlightedHtml = newHighlightedLines[line.new_line_no - 1] ?? escapeHtml(line.content);
          } else if (line.old_line_no != null) {
            highlightedHtml = oldHighlightedLines[line.old_line_no - 1] ?? escapeHtml(line.content);
          } else {
            highlightedHtml = escapeHtml(line.content);
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
              <span
                className="diff-content"
                dangerouslySetInnerHTML={{
                  __html: highlightedHtml || "\n",
                }}
              />
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
          {language && (
            <Tag color="blue">{language}</Tag>
          )}
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
