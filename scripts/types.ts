/** LaunchOS 数据库类型定义 */

// ─── 应用实体 ───
export interface AppEntity {
  Z_PK: number;
  Z_ENT: number; // 固定 1 = AppEntity
  Z_OPT: number; // Core Data 乐观锁
  ZHIDDEN: number; // 0 或空=显示, 1=隐藏
  ZORDER: number; // 分组内排序
  ZGROUP: number; // → ZGROUPENTITY.Z_PK
  Z_FOK_GROUP: number; // Core Data 内部关系
  ZALIAS: string | null; // 别名（可自定义）
  ZBUNDLEID: string;
  ZID: string; // UUID
  ZNAME: string; // 显示名称
  ZURL: string; // 启动 URL (file://...)
}

// ─── 分组实体 ───
export interface GroupEntity {
  Z_PK: number;
  Z_ENT: number; // 固定 2 = GroupEntity
  Z_OPT: number;
  ZISFOLDER: number; // 0=页面, 1=文件夹
  ZORDER: number;
  ZPAGE: number; // 所在页面编号
  ZID: string; // UUID
  ZNAME: string;
}

// ─── Core Data 元数据 ───
export interface PrimaryKey {
  Z_ENT: number;
  Z_NAME: string;
  Z_SUPER: number;
  Z_MAX: number;
}

// ─── 查询用复合类型 ───
export interface GroupWithCount {
  id: number;
  name: string;
  isFolder: boolean;
  page: number;
  order: number;
  appCount: number;
}

export interface AppWithGroup {
  id: number;
  name: string;
  alias: string | null;
  bundleId: string;
  url: string;
  hidden: boolean;
  order: number;
  groupId: number;
  groupName: string | null;
  isFolder: boolean;
}

// ─── 分类规则 ───
export interface ClassificationRule {
  name: string;
  bundleIdPrefix?: string;
  bundleIdPattern?: string;
  nameKeywords?: string[];
  targetGroup: string;
  priority: number;
}

export interface ClassificationResult {
  appId: number;
  appName: string;
  bundleId: string;
  currentGroup: string | null;
  suggestedGroup: string;
  confidence: "high" | "medium" | "low";
  matchedRule: string;
  source?: string; // "knowledge-base" = 静态规则参考, AI 应自行判断是否采纳
}

// ─── 诊断结果 ───
export interface DeadLink {
  appId: number;
  name: string;
  bundleId: string;
  url: string;
}

export interface DuplicateGroup {
  name: string;
  ids: number[];
  count: number;
}

export interface NewAppDiscovery {
  path: string;
  name: string;
  bundleId: string | null;
  suggestedGroup: string;
}

// ─── MCP 工具参数类型 ───
export interface ListAppsParams {
  groupId?: number;
  search?: string;
  bundleId?: string;
  hidden?: boolean;
  limit?: number;
  offset?: number;
}

export interface MoveAppParams {
  appId: number;
  groupId: number;
}

export interface BatchMoveParams {
  appIds: number[];
  groupId: number;
}

export interface CreateGroupParams {
  name: string;
  isFolder?: boolean; // 默认 true
  page?: number; // 默认 0
  order?: number; // 默认自动
}

export interface RenameGroupParams {
  groupId: number;
  newName: string;
}

export interface SetAliasParams {
  appId: number;
  alias: string | null;
}

export interface SetPreferenceParams {
  key: string;
  value: unknown;
}
