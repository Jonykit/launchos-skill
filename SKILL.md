---
name: launchos
description: "管理 LaunchOS（macOS 菜单栏应用启动器）的应用分组。当用户提到 LaunchOS、应用分组整理、菜单栏启动器分类、macOS 应用归类时使用。支持场景：智能自动归类、文件夹合并整理、死链接检测、新应用扫描、数据备份恢复、偏好设置调整。"
version: 1.0.0
metadata: {"requires":{"bins":["tsx"],"deps":"npm install"},"keywords":["LaunchOS","应用分组","应用归类","菜单栏启动器","macOS应用管理","文件夹分类","死链接检测","新应用扫描","备份恢复","偏好设置"],"category":"productivity"}
---

# LaunchOS Skill 使用指南

LaunchOS 将数据存在本地 SQLite 中（`~/Library/Application Support/LaunchOS/LaunchOS.sqlite`）。本 Skill 通过 CLI 工具直接读写数据库。

CLI 入口: `npx tsx {skill_dir}/scripts/cli.ts`
运行 `help` 子命令查看完整命令列表。
数据库结构详见 `{skill_dir}/references/schema.md`。

## ⛔ 版本自检（MANDATORY — 每次触发 Skill 时最先执行）

> 本 Skill 基于 LaunchOS **2.1.1 (Build 302)** 的数据库结构开发。安装版本不一致可能导致数据库结构变化，操作存在风险。Agent **必须**先完成版本比对，跳过此步骤直接操作视为违规。

**Step 1** — 执行版本命令:
```
npx tsx {skill_dir}/scripts/cli.ts version
```
从返回 JSON 中取 `supportedLaunchOS`、`installedLaunchOS`、`compatible` 三个字段。

**Step 2** — 比对并处理:

| 比对结果 | 处理方式 |
|----------|----------|
| `compatible` = `true` | ✅ 版本匹配，继续执行用户请求 |
| `compatible` = `false`，且 installed 版本**低于** supported | ⚠️ LaunchOS 版本过旧。提示用户：「你的 LaunchOS 版本（{installed}）低于 Skill 支持的版本（{supported}）。建议升级 LaunchOS 后再操作，否则数据库结构可能不兼容。是否仍要继续？」— 用户确认后继续 |
| `compatible` = `false`，且 installed 版本**高于** supported | 🔴 LaunchOS 版本更新。提示用户：「你的 LaunchOS 版本（{installed}）高于 Skill 支持的版本（{supported}），数据库结构可能已变更。继续操作可能导致数据损坏或修改丢失。建议等待 Skill 更新。是否仍要继续？」— 用户确认后继续 |
| `installedLaunchOS` = `null` | 🔴 LaunchOS 未安装或无法读取版本。提示用户确认 LaunchOS 已安装，至少运行过一次 |

版本自检通过后，继续执行以下规则。

## 严格规则

### 禁止（NEVER）

- 禁止在 LaunchOS 运行期间执行任何写操作——WAL 日志会覆盖修改，导致数据丢失
- 禁止跳过备份直接执行批量移动或自动归类
- 禁止对数据库手写 SQL——始终通过 CLI 工具操作
- 禁止不展示方案直接执行写操作——所有批量修改必须预览确认

### 必须（MUST）

- 写操作前必须退出 LaunchOS: `osascript -e 'tell application "LaunchOS" to quit'`
- 批量修改前必须先执行 `backup` 备份
- 分类整理必须先分析用户画像、展示方案、用户确认后才执行
- `delete-app`、`restore` 等不可逆操作执行前必须向用户确认
- 修改完成后建议重新执行 `stats` 验证结果一致性

### 核心原则

- **AI 决策，CLI 执行** — 分类逻辑由 AI 动态分析。AI 根据 Bundle ID、应用名等信息自行推理分组归属，不做静态规则匹配
- **尊重用户既有结构** — 不覆盖、不删除已有分组。合并前必须询问用户
- **用户说了算** — 方案永远是预览 → 确认 → 执行，不静默执行

## 快速参考

| 场景 | 命令 |
|------|------|
| 查看整体状况 | `stats` |
| 列出分组及应用数 | `list-groups` |
| 搜索/筛选应用 | `list-apps [--search 关键词] [--group id] [--bundle id] [--hidden]` |
| 获取应用详情 | `get-app <appId>` |
| 移动应用到分组 | `move-app <appId> --to <groupId>` |
| 批量移动 | `batch-move --ids a,b,c --to <groupId>` |
| 隐藏/显示应用 | `hide-app <appId> --hidden true\|false` |
| 设置应用别名 | `set-alias <appId> "<别名>"` |
| 创建文件夹/页面 | `create-group "<名称>" [--page]` |
| 重命名分组 | `rename-group <groupId> "<新名称>"` |
| 删除空分组 | `delete-group <groupId>` |
| 合并分组 | `merge-groups --from <源ID> --to <目标ID>` |
| 检测死链接 | `check-dead` |
| 扫描新应用 | `scan-new` |
| 备份数据 | `backup` |
| 列出备份 | `list-backups` |
| 恢复备份 | `restore <backupId>` |
| 读取偏好设置 | `prefs` |
| 修改偏好设置 | `set-pref <key> <value>` |

## 典型工作流

### 工作流 1：一键整理全部分组（AI 驱动）

这是本 Skill 的核心流程。分类逻辑由 AI 动态完成，不依赖静态规则。

**Step 1：数据采集**
```
backup → list-groups → list-apps
```
获取完整的分组树和所有应用（含名称、Bundle ID、当前分组）。

**Step 2：AI 动态分析**
基于采集到的数据，AI 分析：
1. **用户画像** — 根据应用分布推理用户类型（开发为主？设计为主？全能型？）
2. **现有分组评估** — 哪些分组命名合理可直接用、哪些语义重复建议合并
3. **分组方案生成** — 基于用户画像 + Bundle ID 前缀 + 应用名 + 知识库参考，为每个未归类/归类不当的应用推荐分组
4. **展示给用户**，格式参考：

```
## 📊 应用概览
- 总计 X 个应用，分布在 Y 个分组中
- Z 个应用未归类（散落在页面上）

## 👤 用户画像
- 开发工具 45%，AI 工具 15%，设计 10%，办公 8%...
- → 主力场景：开发 + AI 辅助

## 🗂️ 分组方案

### 保留的现有分组
- "写码" (12 个应用) — 命名尊重你的习惯 ✅
- "画图" (5 个应用) ✅
- "聊天" (8 个应用) — 建议改名为"社交"或保留？

### 建议新建的分组
- "AI 聊天" — ChatGPT, Claude, Kimi, 豆包...
- "浏览器" — Chrome, Edge, Firefox...

### 建议合并的分组
- "开发" + "编程" → 统一为"开发"（或用你偏好的名称？）

### 无法自动判断（需你手动指定）
- App X (bundle: com.xxx.yyy)
- App Y (bundle: com.aaa.bbb)

是否继续？有哪些要调整的？
```

**Step 3：用户确认后执行**
```
create-group × N → batch-move --ids ... → stats(验证)
```

**关键约束：**
- 不要预设固定的分组名称——分组命名应根据用户画像和应用类型动态确定
- 优先保留用户原有的分组命名（"写码"比"开发"更贴合用户习惯）
- 合并分组前一定问用户偏好哪个名称
- 低置信度的应用列出来让用户手动指定，不要自作主张

### 工作流 2：日常增量归类

```
scan-new → AI 分析新应用 → 用户确认 → move-app <id> --to <gid>
```
`scan-new` 输出新应用的名称和 Bundle ID，AI 结合这些信息自行判断归属。

### 工作流 3：清理维护

```
check-dead → 确认后 delete-app | stats → 空文件夹 → delete-group
```
