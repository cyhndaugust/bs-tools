import { useEffect, useState } from "react";
import { Alert, Button, Space, Typography, message } from "antd";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  fetchAvailableUpdate,
  formatUpdateTitle,
  type UpdateInfo,
} from "../lib/updater";

type Status = "idle" | "checking" | "available" | "downloading";

function UpdateBanner() {
  const [status, setStatus] = useState<Status>("idle");
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadUpdate() {
      setStatus("checking");
      try {
        const nextUpdate = await fetchAvailableUpdate();
        if (cancelled) {
          return;
        }

        if (nextUpdate) {
          setUpdateInfo(nextUpdate);
          setStatus("available");
          return;
        }

        setStatus("idle");
      } catch (error) {
        if (!cancelled) {
          setStatus("idle");
          message.warning(`检查更新失败: ${String(error)}`);
        }
      }
    }

    loadUpdate();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleInstall() {
    if (!updateInfo) {
      return;
    }

    setStatus("downloading");
    try {
      await updateInfo.downloadAndInstall();
      message.success("更新已安装，应用即将重启");
      await relaunch();
    } catch (error) {
      setStatus("available");
      message.error(`安装更新失败: ${String(error)}`);
    }
  }

  if (status !== "available" && status !== "downloading") {
    return null;
  }

  return (
    <Alert
      type="info"
      showIcon
      style={{ marginBottom: 16 }}
      message={formatUpdateTitle(updateInfo?.version)}
      description={
        <Space direction="vertical" size={8}>
          <Typography.Text>
            当前版本 {updateInfo?.currentVersion}，{updateInfo?.body}
          </Typography.Text>
          <Button
            type="primary"
            onClick={handleInstall}
            loading={status === "downloading"}
          >
            下载并重启安装
          </Button>
        </Space>
      }
    />
  );
}

export default UpdateBanner;
