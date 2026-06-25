# LaunchOS 数据库结构参考

> 版本: LaunchOS 2.1.1 (Build 302) | BundleID: `app.remixdesign.LaunchOS`

## 数据位置

| 文件 | 路径 |
|------|------|
| 主数据库 | `~/Library/Application Support/LaunchOS/LaunchOS.sqlite` |
| WAL 日志 | `~/Library/Application Support/LaunchOS/LaunchOS.sqlite-wal` |
| 共享内存 | `~/Library/Application Support/LaunchOS/LaunchOS.sqlite-shm` |
| 偏好设置 | `~/Library/Preferences/app.remixdesign.LaunchOS.plist` |

## 表结构

### ZAPPENTITY（应用）

Core Data 实体名: `AppEntity` (Z_ENT = 1)

| 列 | 类型 | 约束 | 说明 |
|----|------|------|------|
| Z_PK | INTEGER | PK, AUTOINCREMENT | 主键 |
| Z_ENT | INTEGER | NOT NULL | 固定为 1 |
| Z_OPT | INTEGER | NOT NULL | Core Data 乐观锁版本号 (1~314+) |
| ZHIDDEN | INTEGER | | 空或0=显示, 1=隐藏 |
| ZORDER | INTEGER | | 分组内排序 (0~28) |
| ZGROUP | INTEGER | FK→ZGROUPENTITY.Z_PK | 所属分组 |
| Z_FOK_GROUP | INTEGER | | Core Data 内部关系标志位 |
| ZALIAS | VARCHAR | | 别名（目前全空，可自定义） |
| ZBUNDLEID | VARCHAR | | Bundle Identifier |
| ZID | VARCHAR | | UUID |
| ZNAME | VARCHAR | | 显示名称 |
| ZURL | VARCHAR | | 启动 URL（file:// 格式） |

**示例行:**
```
Z_PK: 1352
ZNAME: 系统设置
ZBUNDLEID: com.apple.systempreferences
ZURL: file:///System/Applications/System%20Settings.app/
ZGROUP: 1020 → 系统工具
ZHIDDEN: (空)
ZORDER: 0
```

### ZGROUPENTITY（分组）

Core Data 实体名: `GroupEntity` (Z_ENT = 2)

| 列 | 类型 | 约束 | 说明 |
|----|------|------|------|
| Z_PK | INTEGER | PK, AUTOINCREMENT | 主键 |
| Z_ENT | INTEGER | NOT NULL | 固定为 2 |
| Z_OPT | INTEGER | NOT NULL | 乐观锁 (53~324) |
| ZISFOLDER | INTEGER | | 0=页面, 1=文件夹 |
| ZORDER | INTEGER | | 全局排序位置 |
| ZPAGE | INTEGER | | 所在页面编号 (-1~35) |
| ZID | VARCHAR | | UUID |
| ZNAME | VARCHAR | | 分组名称 |

### ZSOURCEENTITY（数据源）

Core Data 实体名: `SourceEntity` (Z_ENT = 3)

| 列 | 类型 | 说明 |
|----|------|------|
| Z_PK | INTEGER | 主键 |
| Z_ENT | INTEGER | 固定为 3 |
| Z_OPT | INTEGER | 乐观锁 |
| ZENABLED | INTEGER | 是否启用 |
| ZTYPE | INTEGER | 来源类型 |
| ZPATH | VARCHAR | 路径 |
| ZID | BLOB | 标识符 |

> 注：当前此表为空，功能未使用。

### Z_METADATA & Z_PRIMARYKEY（Core Data 元数据）

**Z_METADATA**: 存储数据库 UUID（`Z_UUID`）和版本信息（`Z_VERSION`）。
**Z_PRIMARYKEY**: 记录每个实体当前的最大主键值（`Z_MAX`）。

## 偏好设置关键键值

| 键 | 类型 | 说明 | 默认值 |
|----|------|------|--------|
| columns | Integer | 网格列数 | 7 |
| ViewMode | Integer | 视图模式 | 0 |
| SortBy | Integer | 排序方式 | 0 |
| IsFullScreen | Bool | 全屏模式 | false |
| ShowDockIcon | Bool | 显示 Dock 图标 | false |
| ShowMenubarIcon | Bool | 显示菜单栏图标 | false |
| IsBlurWallpaper | Bool | 壁纸模糊 | true |
| BackgroundType | Integer | 背景类型 | 0 |
| GlassMaterial | Integer | 玻璃材质 | 0 |
| LaunchShowOn | Integer | 启动时显示位置 | 1 |
| ReturnToHome | Bool | 返回首页 | true |
| TrackpadGesture | Integer | 触控板手势 | 3 |
| HotCorner | Integer | 热角 (-1=关闭) | -1 |
| EnableF4Shortcut | Bool | F4 快捷键 | false |
| KeyboardShortcuts_launchApp | String | 启动快捷键 (JSON) | — |
