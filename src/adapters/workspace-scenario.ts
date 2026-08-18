import { basename, extname } from "node:path";

const SOURCE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs",
]);

function portable(value: string): string {
  return value.replaceAll("\\", "/");
}

function compact(value: string, maximum = 500): string | undefined {
  const result = value
    .replace(/[`*_>#]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return result.length === 0 ? undefined : result.slice(0, maximum);
}

export function testSourcePath(relativePath: string): boolean {
  const path = portable(relativePath).toLocaleLowerCase("en-US");
  if (!SOURCE_EXTENSIONS.has(extname(path))) return false;
  const name = basename(path);
  return (
    /(?:^|\/)(?:test|tests|__tests__)\//u.test(path) ||
    /\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/u.test(name)
  );
}

export function decisionDocumentPath(relativePath: string): boolean {
  const path = portable(relativePath).toLocaleLowerCase("en-US");
  const name = basename(path);
  if (extname(name) !== ".md" && extname(name) !== ".mdx") return false;
  return (
    /(?:^|\/)(?:adr|adrs|decision|decisions)\//u.test(path) ||
    /^(?:adr|decision)[-_]\d+/u.test(name)
  );
}

export function jsonConfigurationPath(relativePath: string): boolean {
  const path = portable(relativePath).toLocaleLowerCase("en-US");
  const name = basename(path);
  if (extname(name) !== ".json") return false;
  return (
    name === "package.json" ||
    name === "jsconfig.json" ||
    name === ".mcp.json" ||
    /^tsconfig(?:\.[a-z0-9_-]+)?\.json$/u.test(name) ||
    /\.config\.json$/u.test(name) ||
    /(?:^|\/)\.codex-plugin\/plugin\.json$/u.test(path)
  );
}

export interface StaticTestDefinitionContext {
  summary: string;
  titles: string[];
  titleCount: number;
}

export function extractStaticTestDefinitionContext(
  content: string,
): StaticTestDefinitionContext {
  const titles: string[] = [];
  const pattern = /\b(?:it|test)\s*\(\s*(["'`])([^\r\n]{1,240}?)\1/gu;
  for (const match of content.matchAll(pattern)) {
    const title = compact(match[2] ?? "", 160);
    if (title !== undefined && !titles.includes(title)) titles.push(title);
    if (titles.length >= 20) break;
  }
  const visible = titles.slice(0, 3);
  const summary = visible.length === 0
    ? "未提取到静态 test/it 标题；该卡片不执行测试"
    : `检测到 ${titles.length} 个静态 test/it 标题：${visible.join("；")}${titles.length > 3 ? `；另 ${titles.length - 3} 项` : ""}`;
  return { summary, titles: visible, titleCount: titles.length };
}

export interface JsonConfigurationContext {
  purpose: string;
  topLevelKeys: string[];
  keyCount: number;
  parsed: boolean;
}

function configurationPurpose(relativePath: string): string {
  const path = portable(relativePath);
  const name = basename(path).toLocaleLowerCase("en-US");
  if (name === "package.json") return "Node package 边界、脚本与依赖声明";
  if (name.startsWith("tsconfig")) return "TypeScript 编译边界与选项声明";
  if (name === "jsconfig.json") return "JavaScript 工程边界与编辑器选项声明";
  if (name === ".mcp.json") return "MCP server 注册与启动声明";
  if (path.toLocaleLowerCase("en-US").endsWith("/.codex-plugin/plugin.json")) {
    return "Codex Plugin 元数据与能力声明";
  }
  return "JSON 配置边界";
}

export function extractJsonConfigurationContext(
  relativePath: string,
  content: string,
): JsonConfigurationContext {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    return {
      purpose: configurationPurpose(relativePath),
      topLevelKeys: [],
      keyCount: 0,
      parsed: false,
    };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      purpose: configurationPurpose(relativePath),
      topLevelKeys: [],
      keyCount: 0,
      parsed: false,
    };
  }
  const keys = Object.keys(parsed)
    .filter((key) => compact(key, 80) === key)
    .slice(0, 100);
  return {
    purpose: configurationPurpose(relativePath),
    topLevelKeys: keys.slice(0, 5),
    keyCount: keys.length,
    parsed: true,
  };
}

export interface DecisionDocumentContext {
  decision?: string;
  status?: string;
  rationale?: string;
  consequences?: string;
}

function section(
  content: string,
  accepted: ReadonlySet<string>,
): string | undefined {
  const lines = content.split(/\r?\n/u).slice(0, 2_000);
  let collecting = false;
  let fenced = false;
  const values: string[] = [];
  for (const line of lines) {
    const candidate = line.trimStart();
    if (/^```/u.test(candidate)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/u.exec(candidate);
    if (heading !== null) {
      const normalized = compact(heading[1] ?? "", 80)?.toLocaleLowerCase("en-US");
      if (collecting && !accepted.has(normalized ?? "")) break;
      collecting = accepted.has(normalized ?? "");
      continue;
    }
    if (!collecting) continue;
    const value = compact(line);
    if (value !== undefined) values.push(value);
    if (values.join(" ").length >= 500) break;
  }
  return compact(values.join(" "));
}

export function extractDecisionDocumentContext(
  content: string,
): DecisionDocumentContext {
  const decision = section(content, new Set(["decision", "决策", "决定"]));
  const status = section(content, new Set(["status", "状态"]));
  const rationale = section(content, new Set(["context", "rationale", "背景", "原因"]));
  const consequences = section(content, new Set(["consequences", "consequence", "后果", "影响"]));
  return {
    ...(decision === undefined ? {} : { decision }),
    ...(status === undefined ? {} : { status }),
    ...(rationale === undefined ? {} : { rationale }),
    ...(consequences === undefined ? {} : { consequences }),
  };
}
