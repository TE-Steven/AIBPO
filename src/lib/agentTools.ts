import type Anthropic from "@anthropic-ai/sdk";
import type { Skill } from "@/generated/prisma/client";
import type { SkillHeader, SkillParam } from "@/app/(dashboard)/skills/actions";

function buildInputSchema(paramsSchema: SkillParam[]): Anthropic.Tool.InputSchema {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const p of paramsSchema) {
    properties[p.name] = { type: p.type, description: p.description };
    if (p.required) required.push(p.name);
  }
  return { type: "object", properties, required };
}

// Anthropic tool 的 name 只能是 ^[a-zA-Z0-9_-]{1,128}$，Skill 的 name 是自由中文字串不能直接拿來用，
// 所以工具名稱固定用 Skill 的 id（本來就是合法格式），把人看得懂的名稱放進 description 給 AI 判斷用途。
export function buildAgentTools(skills: Skill[]): Anthropic.Tool[] {
  return skills.map((skill) => ({
    name: skill.id,
    description: `${skill.name}：${skill.description}`,
    input_schema: buildInputSchema((skill.paramsSchema as SkillParam[] | null) ?? []),
  }));
}

function substitute(template: string, args: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
    key in args ? encodeURIComponent(String(args[key])) : "",
  );
}

/** 通用 Skill 執行器：把儲存的 method/URL/headers/body 樣板依 AI 提供的參數組成真實 HTTP 請求並送出。 */
export async function executeSkill(skill: Skill, args: Record<string, unknown>): Promise<unknown> {
  const url = substitute(skill.urlTemplate, args);
  const headers: Record<string, string> = {};
  for (const h of (skill.headers as SkillHeader[] | null) ?? []) {
    headers[h.key] = substitute(h.value, args);
  }

  if (skill.authType === "BEARER") {
    const { token } = (skill.authConfig as { token?: string } | null) ?? {};
    if (token) headers.Authorization = `Bearer ${substitute(token, args)}`;
  } else if (skill.authType === "API_KEY_HEADER") {
    const { headerName, value } = (skill.authConfig as { headerName?: string; value?: string } | null) ?? {};
    if (headerName && value) headers[headerName] = substitute(value, args);
  } else if (skill.authType === "BASIC") {
    const { username, password } = (skill.authConfig as { username?: string; password?: string } | null) ?? {};
    if (username) {
      headers.Authorization = `Basic ${Buffer.from(`${username}:${password ?? ""}`).toString("base64")}`;
    }
  }

  const hasBody = ["POST", "PUT", "PATCH"].includes(skill.method);
  const body = hasBody && skill.bodyTemplate ? substitute(skill.bodyTemplate, args) : undefined;
  if (hasBody) headers["Content-Type"] ??= "application/json";

  try {
    const res = await fetch(url, { method: skill.method, headers, body });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // 不是 JSON 回應，維持原始文字。
    }
    if (!res.ok) return { error: `HTTP ${res.status}`, body: parsed };
    return parsed;
  } catch (err) {
    return { error: err instanceof Error ? err.message : "請求失敗" };
  }
}
