"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Anthropic, { toFile } from "@anthropic-ai/sdk";
import { requireCompanyUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { anthropic } from "@/lib/anthropic";
import { officeKindOf, officeToText } from "@/lib/officeToText";

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
    return { error: "請至少上傳一個檔案（PDF、Word、Excel）或輸入一個網址。" };
  }
  const kinds = files.map((f) => officeKindOf(f));
  if (kinds.includes("legacy")) {
    return { error: "不支援舊版 .doc／.xls，請在 Word／Excel 另存成 .docx／.xlsx 再上傳。" };
  }
  if (kinds.includes(null)) {
    return { error: "只接受 PDF、Word（.docx）、Excel（.xlsx）檔案。" };
  }
  if (urls.some((u) => !/^https?:\/\//i.test(u))) {
    return { error: "網址要以 http:// 或 https:// 開頭。" };
  }

  const roleId = session.roleId;
  const createdById = session.id;

  const fileRefs: { fileId: string; fileName: string }[] = [];
  try {
    for (const [i, file] of files.entries()) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const kind = kinds[i];
      // PDF 直接上傳；Word／Excel 先轉成文字，以純文字檔上傳（Claude 只能直接讀 PDF 與純文字）
      const upload =
        kind === "docx" || kind === "xlsx"
          ? await toFile(Buffer.from(await officeToText(kind, buffer, file.name), "utf8"), `${file.name}.txt`, { type: "text/plain" })
          : await toFile(buffer, file.name, { type: "application/pdf" });
      const uploaded = await anthropic.files.upload({ file: upload });
      fileRefs.push({ fileId: uploaded.id, fileName: file.name });
    }
  } catch (err) {
    if (err instanceof Anthropic.APIError) return { error: `上傳到 Claude 失敗：${err.message}` };
    return { error: err instanceof Error ? err.message : "上傳失敗：未知錯誤" };
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
