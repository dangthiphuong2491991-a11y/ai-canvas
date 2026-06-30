# AI 画布

多中转站对接生图 / 生视频的卡片白板桌面应用（Electron + electron-vite + React + tldraw）。

## 开发

```bash
npm install
copy .env.example .env.local    # 填入你的阿里云 OSS 密钥（.env.local 已 gitignore）
npm run dev
```

## 激活系统（Ed25519 离线授权，机器码绑定）

- 程序只内置**公钥**；签发用的**私钥在 `keys/private_key.pem`（已 gitignore，绝不上传 / 打包 / 外发）**。
- 初始化（只做一次，已完成）：`npm run genkeys` 生成密钥对，并把打印出来的公钥填进
  `src/main/licensing.ts` 的 `PUBLIC_KEY_B64`。
- 给客户签发激活码：
  1. 客户在「激活界面」里看到本机**机器码**，发给你；
  2. 你在项目文件夹运行 `node scripts/keygen.mjs <机器码> [备注名] [有效天数]`：
     - 永久：`node scripts/keygen.mjs A1B2-C3D4-... 张三`
     - 一年：`node scripts/keygen.mjs A1B2-C3D4-... 张三 365`
     - （需要本机有 `keys/private_key.pem`）
  3. 把生成的激活码发回客户，客户粘贴即激活。
- 激活码与该机器绑定，不能共享；**未激活时无法生成（主进程会拒绝所有生成请求）**。
- 换签名密钥会让所有旧激活码失效。

## 打包 & 自动更新

客户端启动后会自动检查 GitHub Releases，有新版本就后台下载并提示「重启更新」。
发布新版本两种方式任选其一：

**A. GitHub Actions 自动发布（推荐）**

1. 仓库 `Settings → Secrets and variables → Actions` 添加：
   `OSS_KEY_ID`、`OSS_KEY_SECRET`、`OSS_BUCKET`、`OSS_ENDPOINT`、`OSS_CDN`、`OSS_PREFIX`
   （和 `.env.local` 里同样的值）。
2. 改 `package.json` 的 `version`，然后打标签触发构建：
   ```bash
   git tag v0.1.1
   git push origin v0.1.1
   ```
   Actions 会自动打 Windows 安装包并发到 Releases。

**B. 本地发布**

```bash
set GH_TOKEN=你的GitHubToken
npm run release
```

## 安全须知

- `keys/`、`*.pem`、`.env`、`.env.local` 全部已 gitignore，**绝不能提交到仓库**。
- 客户端会被安装到客户电脑，里面会包含 OSS 密钥（无服务器方案的固有限制）——
  靠激活码控制谁能用。要彻底保护密钥需要后端服务器代理（见对话记录）。
