import { useState, useEffect, useMemo } from "react";
import { Input, List, Typography, Popconfirm, Empty, message, Spin } from "antd";
import { DeleteOutlined, SearchOutlined } from "@ant-design/icons";
import { invoke } from "@tauri-apps/api/core";
import "./QrCode.css";

const { Search } = Input;
const { Text, Paragraph } = Typography;

interface QrCodeItem {
  id: number;
  content: string;
  svg: string;
  created_at: string;
}

function QrCode() {
  const [history, setHistory] = useState<QrCodeItem[]>([]);
  const [currentSvg, setCurrentSvg] = useState<string>("");
  const [currentContent, setCurrentContent] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState("");

  useEffect(() => {
    loadHistory();
  }, []);

  const filteredHistory = useMemo(() => {
    if (!searchKeyword.trim()) return history;
    const kw = searchKeyword.toLowerCase();
    return history.filter((item) => item.content.toLowerCase().includes(kw));
  }, [history, searchKeyword]);

  async function loadHistory() {
    setLoading(true);
    try {
      const items = await invoke<QrCodeItem[]>("get_qr_history");
      setHistory(items);
      if (items.length > 0 && !currentSvg) {
        setCurrentSvg(items[0].svg);
        setCurrentContent(items[0].content);
      }
    } catch (e) {
      message.error(`加载历史失败: ${e}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerate(value: string) {
    if (!value.trim()) {
      message.warning("请输入内容");
      return;
    }
    setGenerating(true);
    try {
      const result = await invoke<QrCodeItem>("generate_qrcode", { content: value });
      setCurrentSvg(result.svg);
      setCurrentContent(result.content);
      setHistory((prev) => [result, ...prev]);
      message.success("生成成功");
    } catch (e) {
      message.error(`生成失败: ${e}`);
    } finally {
      setGenerating(false);
    }
  }

  async function handleDelete(id: number) {
    try {
      await invoke("delete_qr_history", { id });
      setHistory((prev) => {
        const next = prev.filter((item) => item.id !== id);
        if (currentContent && history.find((h) => h.id === id)?.content === currentContent) {
          if (next.length > 0) {
            setCurrentSvg(next[0].svg);
            setCurrentContent(next[0].content);
          } else {
            setCurrentSvg("");
            setCurrentContent("");
          }
        }
        return next;
      });
      message.success("已删除");
    } catch (e) {
      message.error(`删除失败: ${e}`);
    }
  }

  function handleSelect(item: QrCodeItem) {
    setCurrentSvg(item.svg);
    setCurrentContent(item.content);
  }

  return (
    <div className="qrcode-page">
      <div className="qrcode-generator">
        <Search
          placeholder="输入文本或链接，生成二维码"
          enterButton="生成"
          size="large"
          onSearch={handleGenerate}
          loading={generating}
          allowClear
        />
      </div>

      <div className="qrcode-main">
        <div className="qrcode-preview">
          {currentSvg ? (
            <>
              <div
                className="qrcode-svg"
                dangerouslySetInnerHTML={{ __html: currentSvg }}
              />
              <Paragraph
                copyable
                ellipsis={{ rows: 2 }}
                className="qrcode-content-text"
              >
                {currentContent}
              </Paragraph>
            </>
          ) : (
            <Empty description="暂无二维码，请在上方输入内容生成" />
          )}
        </div>

        <div className="qrcode-history">
          <div className="qrcode-history-header">
            <Text strong style={{ fontSize: 16 }}>
              历史记录 ({history.length})
            </Text>
            <Input
              placeholder="搜索历史..."
              prefix={<SearchOutlined style={{ color: "#bbb" }} />}
              allowClear
              size="small"
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              className="qrcode-search-input"
            />
          </div>
          <Spin spinning={loading}>
            {filteredHistory.length === 0 ? (
              <Empty description={searchKeyword ? "无匹配结果" : "暂无历史记录"} />
            ) : (
              <List
                className="qrcode-history-list"
                dataSource={filteredHistory}
                renderItem={(item) => (
                  <List.Item
                    className={`qrcode-history-item ${item.content === currentContent ? "active" : ""}`}
                    onClick={() => handleSelect(item)}
                    actions={[
                      <Popconfirm
                        title="确认删除？"
                        onConfirm={(e) => {
                          e?.stopPropagation();
                          handleDelete(item.id);
                        }}
                        onCancel={(e) => e?.stopPropagation()}
                      >
                        <DeleteOutlined
                          onClick={(e) => e.stopPropagation()}
                          style={{ color: "#999" }}
                        />
                      </Popconfirm>,
                    ]}
                  >
                    <List.Item.Meta
                      title={
                        <Text ellipsis style={{ maxWidth: 280 }}>
                          {item.content}
                        </Text>
                      }
                      description={item.created_at}
                    />
                  </List.Item>
                )}
              />
            )}
          </Spin>
        </div>
      </div>
    </div>
  );
}

export default QrCode;
