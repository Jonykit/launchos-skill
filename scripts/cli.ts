#!/usr/bin/env npx tsx
/**
 * LaunchOS CLI — 应用分组管理工具
 *
 * 用法: npx tsx scripts/cli.ts <命令> [参数]
 * 输出: JSON (stdout) / 日志 (stderr)
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { execSync } from "node:child_process";

// 读取 skill 版本（与 SKILL.md frontmatter 同步）
const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8"));
const SKILL_VERSION = PKG.version;

// 本 Skill 支持的 LaunchOS 版本（数据库结构基于此版本开发）
const LAUNCHOS_APP_PATH = "/Applications/LaunchOS.app";
const SUPPORTED_LAUNCHOS_VERSION = "2.1.1";
const SUPPORTED_LAUNCHOS_BUILD = "302";

function getInstalledLaunchOSVersion(): { version: string; build: string } | null {
  const plist = join(LAUNCHOS_APP_PATH, "Contents", "Info.plist");
  if (!existsSync(plist)) return null;
  try {
    const out = execSync(`plutil -p "${plist}" 2>/dev/null`, { encoding: "utf-8" });
    const verMatch = out.match(/CFBundleShortVersionString" => "(.+?)"/);
    const buildMatch = out.match(/CFBundleVersion" => "(.+?)"/);
    return {
      version: verMatch?.[1] ?? "unknown",
      build: buildMatch?.[1] ?? "unknown",
    };
  } catch {
    return null;
  }
}

// ─── 路径常量 ────────────────────────────────────────

const DB_PATH = join(homedir(), "Library", "Application Support", "LaunchOS", "LaunchOS.sqlite");
const PREF_PATH = join(homedir(), "Library", "Preferences", "app.remixdesign.LaunchOS.plist");
const BACKUP_DIR = join(homedir(), "Library", "Application Support", "LaunchOS", "backups");

// ─── 工具函数 ────────────────────────────────────────

function openDb() {
  if (!existsSync(DB_PATH)) throw new Error(`数据库未找到: ${DB_PATH}`);
  return new Database(DB_PATH);
}

function isLaunchOSRunning(): boolean {
  try {
    return execSync("pgrep -l LaunchOS 2>/dev/null || true", { encoding: "utf-8" }).trim().length > 0;
  } catch { return false; }
}

function warnIfRunning() {
  if (isLaunchOSRunning()) {
    console.error("⚠️  LaunchOS 正在运行，写操作可能被覆盖。建议先: osascript -e 'tell application \"LaunchOS\" to quit'");
  }
}

function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function out(data: unknown) {
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

function die(msg: string): never {
  out({ error: msg });
  process.exit(1);
}

// ─── 简单参数解析 ────────────────────────────────────

function parseArgs(argv: string[]): {
  command: string;
  args: string[];
  opts: Record<string, string>;
} {
  const positional: string[] = [];
  const opts: Record<string, string> = {};
  let i = 0;

  // 跳过 node 和脚本路径
  const cmdIndex = argv.findIndex(a => a.endsWith("cli.ts") || a.endsWith("cli"));
  const start = cmdIndex >= 0 ? cmdIndex + 1 : 2;

  for (i = start; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      // 检查下一个值
      if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
        opts[key] = argv[++i];
      } else {
        opts[key] = "true"; // 布尔标志
      }
    } else {
      positional.push(arg);
    }
  }

  return {
    command: positional[0] ?? "",
    args: positional.slice(1),
    opts,
  };
}

// ─── 命令处理 ─────────────────────────────────────────

type Handler = (args: string[], opts: Record<string, string>) => void;

const commands: Record<string, Handler> = {
  // ═══ 查询 ═══
  "list-apps"(args, opts) {
    const db = openDb();
    const conds: string[] = [];
    const params: Record<string, unknown> = {};
    if (opts.group) { conds.push("a.ZGROUP = @g"); params.g = +opts.group; }
    if (opts.search) { conds.push("a.ZNAME LIKE @s"); params.s = `%${opts.search}%`; }
    if (opts.bundle) { conds.push("a.ZBUNDLEID = @b"); params.b = opts.bundle; }
    if (opts.hidden) { conds.push("a.ZHIDDEN = 1"); }
    const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
    const limit = +opts.limit || 50;
    const offset = +opts.offset || 0;
    const total = (db.prepare(`SELECT COUNT(*) as c FROM ZAPPENTITY a ${where}`).get(params) as { c: number }).c;
    const rows = db.prepare(
      `SELECT a.Z_PK as id, a.ZNAME as name, a.ZALIAS as alias, a.ZBUNDLEID as bundleId,
              (CASE WHEN a.ZHIDDEN=1 THEN 1 ELSE 0 END) as hidden,
              a.ZGROUP as groupId, g.ZNAME as group, g.ZISFOLDER as isFolder
       FROM ZAPPENTITY a LEFT JOIN ZGROUPENTITY g ON a.ZGROUP=g.Z_PK
       ${where} ORDER BY a.ZNAME LIMIT @l OFFSET @o`
    ).all({ ...params, l: limit, o: offset });
    db.close();
    if (opts.jsonl) {
      for (const r of rows) process.stdout.write(JSON.stringify(r) + "\n");
    } else {
      out({ total, count: (rows as unknown[]).length, apps: rows });
    }
  },

  "get-app"(args) {
    const db = openDb();
    const id = +args[0];
    const row = db.prepare(
      `SELECT a.*, g.ZNAME as groupName, g.ZISFOLDER as isFolder
       FROM ZAPPENTITY a LEFT JOIN ZGROUPENTITY g ON a.ZGROUP=g.Z_PK WHERE a.Z_PK=?`
    ).get(id);
    db.close();
    if (!row) die(`应用 id=${id} 不存在`);
    out(row);
  },

  "list-groups"() {
    const db = openDb();
    const rows = db.prepare(
      `SELECT g.Z_PK as id, g.ZNAME as name, g.ZISFOLDER as isFolder,
              g.ZPAGE as page, g.ZORDER as "order", COUNT(a.Z_PK) as appCount
       FROM ZGROUPENTITY g LEFT JOIN ZAPPENTITY a ON a.ZGROUP=g.Z_PK
       GROUP BY g.Z_PK ORDER BY g.ZISFOLDER DESC, g.ZORDER`
    ).all();
    db.close();
    out(rows);
  },

  "stats"() {
    const db = openDb();
    const groups = db.prepare(
      `SELECT g.Z_PK as id, g.ZNAME as name, g.ZISFOLDER as isFolder,
              g.ZPAGE as page, COUNT(a.Z_PK) as appCount
       FROM ZGROUPENTITY g LEFT JOIN ZAPPENTITY a ON a.ZGROUP=g.Z_PK
       GROUP BY g.Z_PK ORDER BY appCount DESC`
    ).all();
    const total = (db.prepare("SELECT COUNT(*) as c FROM ZAPPENTITY").get() as { c: number }).c;
    const hidden = (db.prepare("SELECT COUNT(*) as c FROM ZAPPENTITY WHERE ZHIDDEN=1").get() as { c: number }).c;
    const dupes = db.prepare(
      "SELECT ZNAME as name, COUNT(*) as cnt, GROUP_CONCAT(Z_PK) as ids FROM ZAPPENTITY GROUP BY ZNAME HAVING COUNT(*)>1"
    ).all();
    db.close();
    const gs = groups as Array<{ id: number; name: string; isFolder: number; page: number; appCount: number }>;
    out({
      overview: {
        totalApps: total,
        hiddenApps: hidden,
        groups: gs.length,
        folders: gs.filter(g => g.isFolder).length,
      },
      groups: gs,
      duplicates: (dupes as unknown[]).length ? dupes : null,
      emptyFolders: gs.filter(g => g.isFolder && g.appCount === 0).length ? gs.filter(g => g.isFolder && g.appCount === 0) : null,
    });
  },

  // ═══ 写入 ═══
  "move-app"(args, opts) {
    warnIfRunning();
    const appId = +args[0];
    const groupId = +opts.to;
    if (!groupId) die("需要 --to <groupId>");
    const db = openDb();
    const g = db.prepare("SELECT ZNAME FROM ZGROUPENTITY WHERE Z_PK=?").get(groupId) as { ZNAME: string } | undefined;
    if (!g) die(`分组 ${groupId} 不存在`);
    const a = db.prepare("SELECT ZNAME FROM ZAPPENTITY WHERE Z_PK=?").get(appId) as { ZNAME: string } | undefined;
    if (!a) die(`应用 ${appId} 不存在`);
    db.prepare("UPDATE ZAPPENTITY SET ZGROUP=? WHERE Z_PK=?").run(groupId, appId);
    db.close();
    out({ ok: true, app: a.ZNAME, movedTo: g.ZNAME });
  },

  "batch-move"(args, opts) {
    warnIfRunning();
    const ids = (opts.ids || "").split(",").map(Number).filter(n => !isNaN(n));
    const groupId = +opts.to;
    if (!ids.length) die("需要 --ids <id1,id2,...>");
    if (!groupId) die("需要 --to <groupId>");
    if (ids.length > 100) die("最多 100 个");
    const db = openDb();
    const g = db.prepare("SELECT ZNAME FROM ZGROUPENTITY WHERE Z_PK=?").get(groupId) as { ZNAME: string } | undefined;
    if (!g) die(`分组 ${groupId} 不存在`);
    const upd = db.prepare("UPDATE ZAPPENTITY SET ZGROUP=? WHERE Z_PK=?");
    db.transaction(() => { for (const id of ids) upd.run(groupId, id); })();
    db.close();
    out({ ok: true, moved: ids.length, to: g.ZNAME });
  },

  "hide-app"(args, opts) {
    const appId = +args[0];
    const hidden = opts.hidden === "true" || opts.hidden === "1";
    const db = openDb();
    db.prepare("UPDATE ZAPPENTITY SET ZHIDDEN=? WHERE Z_PK=?").run(hidden ? 1 : null, appId);
    db.close();
    out({ ok: true, hidden });
  },

  "set-alias"(args) {
    const appId = +args[0];
    const alias = args[1] || null;
    const db = openDb();
    db.prepare("UPDATE ZAPPENTITY SET ZALIAS=? WHERE Z_PK=?").run(alias, appId);
    db.close();
    out({ ok: true, alias });
  },

  "delete-app"(args) {
    warnIfRunning();
    const appId = +args[0];
    const db = openDb();
    const a = db.prepare("SELECT ZNAME FROM ZAPPENTITY WHERE Z_PK=?").get(appId) as { ZNAME: string } | undefined;
    if (!a) die("不存在");
    db.prepare("DELETE FROM ZAPPENTITY WHERE Z_PK=?").run(appId);
    db.close();
    out({ ok: true, deleted: a.ZNAME });
  },

  // ═══ 分组管理 ═══
  "create-group"(args, opts) {
    warnIfRunning();
    const name = args[0];
    if (!name) die("需要分组名称");
    const db = openDb();
    if (db.prepare("SELECT Z_PK FROM ZGROUPENTITY WHERE ZNAME=?").get(name)) {
      die(`分组「${name}」已存在`);
    }
    const pk = (db.prepare("SELECT Z_MAX FROM Z_PRIMARYKEY WHERE Z_ENT=2").get() as { Z_MAX: number }).Z_MAX;
    const newId = pk + 1;
    const maxOrder = (db.prepare("SELECT MAX(ZORDER) as m FROM ZGROUPENTITY").get() as { m: number }).m;
    const order = opts.order ? +opts.order : maxOrder + 1;
    const isFolder = opts.page ? 0 : 1;
    const pageNum = opts["page-num"] ? +opts["page-num"] : 0;
    db.prepare(
      "INSERT INTO ZGROUPENTITY(Z_PK,Z_ENT,Z_OPT,ZISFOLDER,ZORDER,ZPAGE,ZID,ZNAME) VALUES(?,2,310,?,?,?,?,?)"
    ).run(newId, isFolder, order, pageNum, uuid(), name);
    db.prepare("UPDATE Z_PRIMARYKEY SET Z_MAX=? WHERE Z_ENT=2").run(newId);
    db.close();
    out({ ok: true, id: newId, name, isFolder: !!isFolder });
  },

  "rename-group"(args) {
    const groupId = +args[0];
    const newName = args[1];
    if (!newName) die("需要新名称");
    const db = openDb();
    db.prepare("UPDATE ZGROUPENTITY SET ZNAME=? WHERE Z_PK=?").run(newName, groupId);
    db.close();
    out({ ok: true, newName });
  },

  "delete-group"(args) {
    warnIfRunning();
    const groupId = +args[0];
    const db = openDb();
    const g = db.prepare("SELECT ZNAME FROM ZGROUPENTITY WHERE Z_PK=?").get(groupId) as { ZNAME: string } | undefined;
    if (!g) die("不存在");
    const cnt = (db.prepare("SELECT COUNT(*) as c FROM ZAPPENTITY WHERE ZGROUP=?").get(groupId) as { c: number }).c;
    if (cnt > 0) die(`「${g.ZNAME}」内有 ${cnt} 个应用，无法删除。请先移动或使用 merge-groups`);
    db.prepare("DELETE FROM ZGROUPENTITY WHERE Z_PK=?").run(groupId);
    db.close();
    out({ ok: true, deleted: g.ZNAME });
  },

  "merge-groups"(args, opts) {
    warnIfRunning();
    const from = +opts.from;
    const to = +opts.to;
    if (!from || !to) die("需要 --from <id> --to <id>");
    const db = openDb();
    const src = db.prepare("SELECT ZNAME FROM ZGROUPENTITY WHERE Z_PK=?").get(from) as { ZNAME: string } | undefined;
    const dst = db.prepare("SELECT ZNAME FROM ZGROUPENTITY WHERE Z_PK=?").get(to) as { ZNAME: string } | undefined;
    if (!src || !dst) die("分组不存在");
    const r = db.prepare("UPDATE ZAPPENTITY SET ZGROUP=? WHERE ZGROUP=?").run(to, from);
    db.prepare("DELETE FROM ZGROUPENTITY WHERE Z_PK=?").run(from);
    db.close();
    out({ ok: true, from: src.ZNAME, to: dst.ZNAME, moved: r.changes });
  },

  // ═══ 诊断 ═══
  "check-dead"() {
    const db = openDb();
    const rows = db.prepare("SELECT Z_PK as id, ZNAME as name, ZBUNDLEID as bundleId, ZURL as url FROM ZAPPENTITY").all() as Array<{ id: number; name: string; bundleId: string; url: string }>;
    db.close();
    const dead = rows.filter(r => {
      const fp = r.url.startsWith("file://") ? decodeURIComponent(r.url.replace("file://", "")) : r.url;
      return !existsSync(fp);
    });
    out({ total: rows.length, dead: dead.length, alive: rows.length - dead.length, deadLinks: dead.slice(0, 100) });
  },

  "scan-new"() {
    const db = openDb();
    const existing = new Set((db.prepare("SELECT ZBUNDLEID FROM ZAPPENTITY").all() as Array<{ ZBUNDLEID: string }>).map(r => r.ZBUNDLEID));
    db.close();
    const found: Array<{ path: string; name: string; bundleId: string }> = [];
    if (!existsSync("/Applications")) die("/Applications 不存在");
    for (const entry of readdirSync("/Applications")) {
      if (!entry.endsWith(".app")) continue;
      const plist = join("/Applications", entry, "Contents", "Info.plist");
      if (!existsSync(plist)) continue;
      try {
        const out = execSync(`plutil -p "${plist}" 2>/dev/null | grep CFBundleIdentifier | head -1`, { encoding: "utf-8" });
        const m = out.match(/"(.+?)"/);
        if (!m || existing.has(m[1])) continue;
        const name = entry.replace(/\.app$/, "");
        found.push({ path: join("/Applications", entry), name, bundleId: m[1] });
      } catch { /* skip */ }
    }
    out({ total: found.length, newApps: found });
  },

  // ═══ 备份 ═══
  "backup"() {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const dir = join(BACKUP_DIR, stamp);
    mkdirSync(dir, { recursive: true });
    if (existsSync(DB_PATH)) copyFileSync(DB_PATH, join(dir, "LaunchOS.sqlite"));
    if (existsSync(DB_PATH + "-wal")) copyFileSync(DB_PATH + "-wal", join(dir, "LaunchOS.sqlite-wal"));
    if (existsSync(DB_PATH + "-shm")) copyFileSync(DB_PATH + "-shm", join(dir, "LaunchOS.sqlite-shm"));
    if (existsSync(PREF_PATH)) copyFileSync(PREF_PATH, join(dir, "app.remixdesign.LaunchOS.plist"));
    const cnt = (new Database(DB_PATH, { readonly: true }).prepare("SELECT COUNT(*) as c FROM ZAPPENTITY").get() as { c: number }).c;
    writeFileSync(join(dir, "backup.json"), JSON.stringify({ timestamp: stamp, appCount: cnt }, null, 2));
    out({ ok: true, path: dir, appCount: cnt });
  },

  "list-backups"() {
    if (!existsSync(BACKUP_DIR)) { out([]); return; }
    const list = readdirSync(BACKUP_DIR, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => {
        const m = join(BACKUP_DIR, e.name, "backup.json");
        return { id: e.name, ...(existsSync(m) ? JSON.parse(readFileSync(m, "utf-8")) : {}) };
      })
      .sort((a: { id: string }, b: { id: string }) => b.id.localeCompare(a.id));
    out(list);
  },

  "restore"(args) {
    warnIfRunning();
    const backupId = args[0];
    if (!backupId) die("需要备份 ID");
    const dir = join(BACKUP_DIR, backupId);
    if (!existsSync(dir)) die(`备份 ${backupId} 不存在`);
    const f = join(dir, "LaunchOS.sqlite");
    if (!existsSync(f)) die("备份不完整");
    copyFileSync(f, DB_PATH);
    for (const ext of ["-wal", "-shm"]) {
      const src = join(dir, "LaunchOS.sqlite" + ext);
      if (existsSync(src)) copyFileSync(src, DB_PATH + ext);
    }
    const pp = join(dir, "app.remixdesign.LaunchOS.plist");
    if (existsSync(pp)) copyFileSync(pp, PREF_PATH);
    out({ ok: true, restored: backupId });
  },

  // ═══ 偏好设置 ═══
  "prefs"() {
    if (!existsSync(PREF_PATH)) die("偏好文件不存在");
    const json = execSync(`plutil -convert json -o - "${PREF_PATH}"`, { encoding: "utf-8" });
    out(JSON.parse(json));
  },

  "set-pref"(args) {
    const key = args[0];
    const raw = args[1];
    if (!key || raw === undefined) die("需要: set-pref <key> <value>");
    if (!existsSync(PREF_PATH)) die("偏好文件不存在");
    let value: unknown = raw;
    if (raw === "true") value = true;
    else if (raw === "false") value = false;
    else if (/^-?\d+(\.\d+)?$/.test(raw)) value = Number(raw);
    const json = execSync(`plutil -convert json -o - "${PREF_PATH}"`, { encoding: "utf-8" });
    const prefs = JSON.parse(json);
    prefs[key] = value;
    const tmp = join(dirname(PREF_PATH), "launchos_pref_tmp.json");
    writeFileSync(tmp, JSON.stringify(prefs));
    execSync(`plutil -convert binary1 "${tmp}" -o "${PREF_PATH}"`);
    require("node:fs").unlinkSync(tmp);
    out({ ok: true, key, value });
  },

  "version"() {
    const installed = getInstalledLaunchOSVersion();
    out({
      skillVersion: SKILL_VERSION,
      supportedLaunchOS: { version: SUPPORTED_LAUNCHOS_VERSION, build: SUPPORTED_LAUNCHOS_BUILD },
      installedLaunchOS: installed,
      compatible: installed
        ? installed.version === SUPPORTED_LAUNCHOS_VERSION && installed.build === SUPPORTED_LAUNCHOS_BUILD
        : null,
      dbPath: DB_PATH,
      dbExists: existsSync(DB_PATH),
      launchOSRunning: isLaunchOSRunning(),
    });
  },
};

// ─── 帮助 ─────────────────────────────────────────────

function showHelp() {
  const text = `LaunchOS CLI — 应用分组管理工具

用法: npx tsx scripts/cli.ts <命令> [参数]

查询:
  list-apps    [--group id] [--search text] [--bundle id] [--hidden] [--limit n] [--offset n] [--jsonl]
  get-app      <appId>
  list-groups
  stats

写入 (需退出 LaunchOS):
  move-app     <appId> --to <groupId>
  batch-move   --ids id1,id2,... --to <groupId>
  hide-app     <appId> --hidden true|false
  set-alias    <appId> <alias>
  delete-app   <appId>

分组:
  create-group <name> [--page] [--page-num n] [--order n]
  rename-group <groupId> <newName>
  delete-group <groupId>
  merge-groups --from <id> --to <id>

诊断:
  check-dead
  scan-new

备份:
  backup
  list-backups
  restore      <backupId>

偏好:
  prefs
  set-pref     <key> <value>

其他:
  version      输出版本和状态信息
`;
  console.error(text);
}

// ─── 入口 ─────────────────────────────────────────────

const { command, args, opts } = parseArgs(process.argv);

if (!command || command === "help" || opts.help) {
  showHelp();
  process.exit(0);
}

const handler = commands[command];
if (!handler) {
  console.error(`未知命令: ${command}`);
  console.error(`可用命令: ${Object.keys(commands).join(", ")}`);
  process.exit(1);
}

try {
  handler(args, opts);
} catch (e) {
  if (!(e as Error).message.startsWith("{")) {
    out({ error: (e as Error).message });
    process.exit(1);
  }
  // 已通过 die() 处理
}
