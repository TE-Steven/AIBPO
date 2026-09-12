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
  const file = formData.get("file") as File | null;

  if (!file || file.size === 0) {
    return { error: "請選擇一個 PDF 檔案。" };
  }
  if (file.type !== "application/pdf") {
    return { error: "只接受 PDF 檔案。" };
  }

  const roleId = session.kind === "superadmin" ? await firstRoleId() : session.roleId;
  const createdById = session.kind === "superadmin" ? "SUPERADMIN" : session.id;

  let uploadedFileId: string;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const uploaded = await anthropic.files.upload({
      file: await toFile(buffer, file.name, { type: "application/pdf" }),
    });
    uploadedFileId = uploaded.id;
  } catch (err) {
    return { error: `上傳到 Claude 失敗：${err instanceof Anthropic.APIError ? err.message : "未知錯誤"}` };
  }

  const source = await prisma.kmSource.create({
    data: {
      title: file.name.replace(/\.pdf$/i, ""),
      sourceType: "PDF",
      sourceName: file.name,
      sourceFileId: uploadedFileId,
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
  const url = String(formData.get("url") ?? "").trim();

  if (!url || !/^https?:\/\//i.test(url)) {
    return { error: "請輸入正確的網址（要以 http:// 或 https:// 開頭）。" };
  }

  const roleId = session.kind === "superadmin" ? await firstRoleId() : session.roleId;
  const createdById = session.kind === "superadmin" ? "SUPERADMIN" : session.id;

  const source = await prisma.kmSource.create({
    data: {
      title: url,
      sourceType: "URL",
      sourceUrl: url,
      status: "PENDING",
      roleId,
      createdById,
    },
  });

  revalidatePath("/km/new");
  redirect(`/km/new/${source.id}`);
}
