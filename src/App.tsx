import { Routes, Route, useNavigate, useLocation } from "react-router-dom";
import { Layout, Menu } from "antd";
import {
  QrcodeOutlined,
  UnorderedListOutlined,
  DiffOutlined,
} from "@ant-design/icons";
import QrCode from "./pages/QrCode";
import MenuParser from "./pages/MenuParser";
import DiffTool from "./pages/DiffTool";
import "./App.css";

const { Sider, Content } = Layout;

const menuItems = [
  {
    key: "/",
    icon: <QrcodeOutlined />,
    label: "二维码生成",
  },
  {
    key: "/menu-parser",
    icon: <UnorderedListOutlined />,
    label: "菜单解析",
  },
  {
    key: "/diff",
    icon: <DiffOutlined />,
    label: "文件对比",
  },
];

function App() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider width={180} theme="light" style={{ borderRight: "1px solid #f0f0f0" }}>
        <div className="app-logo">BS Tools</div>
        <Menu
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
          style={{ borderRight: 0 }}
        />
      </Sider>
      <Layout>
        <Content className="app-content">
          <Routes>
            <Route path="/" element={<QrCode />} />
            <Route path="/menu-parser" element={<MenuParser />} />
            <Route path="/diff" element={<DiffTool />} />
          </Routes>
        </Content>
      </Layout>
    </Layout>
  );
}

export default App;
