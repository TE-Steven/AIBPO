"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Anthropic, { toFile } from "@anthropic-ai/sdk";
import { requireCompanyUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { anthropic } from "@/lib/anthropic";

export type CreateSourceState = { error?: string };

export async function createSourceAction(
  _prevState: CreateSourceState,
  formData: FormData,
): Promise<CreateSourceState> {
  const session = await requireCompanyUser();
  const title = String(formData.get("title") ?? "").trim();
  const files = formData.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
  const urls = formData
    .getAll("url")
    .map((u) => String(u).trim())
    .filter(Boolean);

  if (!title) {
    return { error: "請先輸入名稱。" };
  }
  if (files.length === 0 && urls.length === 0) {
    return { error: "請至少上傳一個 PDF 檔案或輸入一個網址。" };
  }
  if (files.some((f) => f.type !== "application/pdf")) {
    return { error: "只接受 PDF 檔案。" };
  }
  if (urls.some((u) => !/^https?:\/\//i.test(u))) {
    return { error: "網址要以 http:// 或 https:// 開頭。" };
  }

  const roleId = session.roleId;
  const createdById = session.id;

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

  const sourceType = fileRefs.length > 0 && urls.length > 0 ? "MIXED" : fileRefs.length > 0 ? "PDF" : "URL";

  const source = await prisma.kmSource.create({
    data: {
      title,
      sourceType,
      sourceFileIds: fileRefs.length > 0 ? fileRefs : undefined,
      sourceUrls: urls.length > 0 ? urls : undefined,
      status: "PENDING",
      roleId,
      createdById,
    },
  });

  revalidatePath("/km/new");
  redirect(`/km/new/${source.id}`);
}
