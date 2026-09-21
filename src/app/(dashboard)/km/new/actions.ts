"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Anthropic, { toFile } from "@anthropic-ai/sdk";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { anthropic } from "@/lib/anthropic";

export type CreateSourceState = { error?: string };

async function firstRoleId(): Promise<string> {
  const role = await prisma.role.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
  return role.id;
}

export async function createPdfSourceAction(
  _prevState: CreateSourceState,
  formData: FormData,
): Promise<CreateSourceState> {
  const session = await requireSession();
  const title = String(formData.get("title") ?? "").trim();
  const files = formData.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);

  if (!title) {
    return { error: "請先輸入名稱。" };
  }
  if (files.length === 0) {
    return { error: "請選擇至少一個 PDF 檔案。" };
  }
  if (files.some((f) => f.type !== "application/pdf")) {
    return { error: "只接受 PDF 檔案。" };
  }

  const roleId = session.kind === "superadmin" ? await firstRoleId() : session.roleId;
  const createdById = session.kind === "superadmin" ? "SUPERADMIN" : session.id;

  const fileRefs: { fileId: string; fileName: string }[] = [];
  try {
    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const uploaded = await anthropic.files.upload({
        file: await toFile(buffer, file.name, { type: "application/pdf" }),
      });
      fileRefs.push({ fileId: uploaded.id, fileName: file.name });
    }
  } catch (err) {
    return { error: `上傳到 Claude 失敗：${err instanceof Anthropic.APIError ? err.message : "未知錯誤"}` };
  }

  const source = await prisma.kmSource.create({
    data: {
      title,
      sourceType: "PDF",
      sourceFileIds: fileRefs,
      status: "PENDING",
      roleId,
      createdById,
    },
  });

  revalidatePath("/km/new");
  redirect(`/km/new/${source.id}`);
}

export async function createUrlSourceAction(
  _prevState: CreateSourceState,
  formData: FormData,
): Promise<CreateSourceState> {
  const session = await requireSession();
  const title = String(formData.get("title") ?? "").trim();
  const urls = formData
    .getAll("url")
    .map((u) => String(u).trim())
    .filter(Boolean);

  if (!title) {
    return { error: "請先輸入名稱。" };
  }
  if (urls.length === 0) {
    return { error: "請輸入至少一個網址。" };
  }
  if (urls.some((u) => !/^https?:\/\//i.test(u))) {
    return { error: "網址要以 http:// 或 https:// 開頭。" };
  }

  const roleId = session.kind === "superadmin" ? await firstRoleId() : session.roleId;
  const createdById = session.kind === "superadmin" ? "SUPERADMIN" : session.id;

  const source = await prisma.kmSource.create({
    data: {
      title,
      sourceType: "URL",
      sourceUrls: urls,
      status: "PENDING",
      roleId,
      createdById,
    },
  });

  revalidatePath("/km/new");
  redirect(`/km/new/${source.id}`);
}
