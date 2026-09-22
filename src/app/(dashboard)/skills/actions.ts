"use server";

import { revalidatePath } from "next/cache";
import { requireSession, requireCompanyUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";

export type SkillActionState = { success?: string; error?: string };

export type SkillHeader = { key: string; value: string };
export type SkillParam = { name: string; type: string; description: string; required: boolean };

const VALID_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const VALID_AUTH_TYPES = ["NONE", "BEARER", "API_KEY_HEADER", "BASIC"];
const VALID_PARAM_TYPES = ["string", "number", "boolean", "array"];

function parseHeaders(raw: FormDataEntryValue | null): SkillHeader[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(raw));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((h): h is SkillHeader => typeof h === "object" && h !== null && typeof h.key === "string")
    .map((h) => ({ key: h.key.trim(), value: String(h.value ?? "") }))
    .filter((h) => h.key.length > 0);
}

function parseParamsSchema(raw: FormDataEntryValue | null): SkillParam[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(raw));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((p): p is SkillParam => typeof p === "object" && p !== null && typeof p.name === "string")
    .map((p) => ({
      name: p.name.trim(),
      type: VALID_PARAM_TYPES.includes(p.type) ? p.type : "string",
      description: String(p.description ?? ""),
      required: Boolean(p.required),
    }))
    .filter((p) => p.name.length > 0);
}

function buildAuthConfig(authType: string, formData: FormData): unknown {
  if (authType === "BEARER") {
    return { token: String(formData.get("authToken") ?? "").trim() };
  }
  if (authType === "API_KEY_HEADER") {
    return {
      headerName: String(formData.get("authHeaderName") ?? "").trim(),
      value: String(formData.get("authHeaderValue") ?? "").trim(),
    };
  }
  if (authType === "BASIC") {
    return {
      username: String(formData.get("authUsername") ?? "").trim(),
      password: String(formData.get("authPassword") ?? "").trim(),
    };
  }
  return null;
}

function readSkillFields(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const method = String(formData.get("method") ?? "GET").toUpperCase();
  const urlTemplate = String(formData.get("urlTemplate") ?? "").trim();
  const authType = String(formData.get("authType") ?? "NONE").toUpperCase();
  const bodyTemplate = String(formData.get("bodyTemplate") ?? "").trim();
  const headers = parseHeaders(formData.get("headersJson"));
  const paramsSchema = parseParamsSchema(formData.get("paramsJson"));

  if (!name) return { error: "名稱不能是空的。" } as const;
  if (!description) return { error: "說明不能是空的（AI 會靠這段判斷何時該用這個 Skill）。" } as const;
  if (!VALID_METHODS.includes(method)) return { error: "HTTP 方法不合法。" } as const;
  if (!urlTemplate) return { error: "URL 不能是空的。" } as const;
  if (!VALID_AUTH_TYPES.includes(authType)) return { error: "認證方式不合法。" } as const;

  const authConfig = buildAuthConfig(authType, formData);
  const hasBody = ["POST", "PUT", "PATCH"].includes(method);

  return {
    data: {
      name,
      description,
      method,
      urlTemplate,
      authType,
      authConfig: authType === "NONE" ? Prisma.JsonNull : (authConfig as object),
      headers: headers.length > 0 ? headers : Prisma.JsonNull,
      bodyTemplate: hasBody && bodyTemplate ? bodyTemplate : null,
      paramsSchema,
    },
  } as const;
}

export async function createSkillAction(
  _prevState: SkillActionState,
  formData: FormData,
): Promise<SkillActionState> {
  const session = await requireCompanyUser();
  const result = readSkillFields(formData);
  if ("error" in result) return { error: result.error };

  await prisma.skill.create({ data: { ...result.data, roleId: session.roleId, createdById: session.id } });

  revalidatePath("/skills");
  return { success: `Skill「${result.data.name}」已建立。` };
}

export async function updateSkillAction(
  skillId: string,
  _prevState: SkillActionState,
  formData: FormData,
): Promise<SkillActionState> {
  const session = await requireSession();

  const skill = await prisma.skill.findUnique({ where: { id: skillId } });
  if (!skill) return { error: "找不到這個 Skill。" };
  if (session.kind !== "superadmin" && skill.roleId !== session.roleId) {
    return { error: "沒有權限編輯這個 Skill。" };
  }

  const result = readSkillFields(formData);
  if ("error" in result) return { error: result.error };

  await prisma.skill.update({ where: { id: skillId }, data: result.data });

  revalidatePath("/skills");
  revalidatePath(`/skills/${skillId}`);
  return { success: `Skill「${result.data.name}」已更新。` };
}

export async function deleteSkillAction(skillId: string): Promise<void> {
  const session = await requireSession();

  const skill = await prisma.skill.findUnique({ where: { id: skillId } });
  if (!skill) return;
  if (session.kind !== "superadmin" && skill.roleId !== session.roleId) return;

  await prisma.skill.delete({ where: { id: skillId } });
  revalidatePath("/skills");
}
