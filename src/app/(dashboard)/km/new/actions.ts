"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireCompanyUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { verifyUpload, type SignedUpload } from "@/lib/sourceUpload";
import { checkTotals } from "@/lib/sourceLimits";
import type { SourceFileRef } from "@/lib/kmAnalysis";

export type CreateSourceState = { error?: string };

// 建立來源：檔案已經在畫面上一個一個上傳完（/api/km/source-files），這裡只收簽章過的檔案參照與網址。
export async function createSourceAction(input: { title: string; urls: string[]; uploads: SignedUpload[] }): Promise<CreateSourceState> {
  const session = await requireCompanyUser();
  const title = input.title.trim();
  const urls = input.urls.map((u) => u.trim()).filter(Boolean);

  if (!title) return { error: "請先輸入名稱。" };
  if (input.uploads.length === 0 && urls.length === 0) {
    return { error: "請至少上傳一個檔案（PDF、Word、Excel）或輸入一個網址。" };
  }
  if (urls.some((u) => !/^https?:\/\//i.test(u))) {
    return { error: "網址要以 http:// 或 https:// 開頭。" };
  }

  const uploads = input.uploads.map((u) => verifyUpload(session.id, u));
  if (uploads.some((u) => u === null)) return { error: "檔案驗證失敗，請重新上傳。" };
  const verified = uploads.filter((u): u is NonNullable<typeof u> => u !== null);
  // 伺服器端再檢查一次加總，超過上限的來源分析一定會失敗
  const totals = checkTotals(verified.map((u) => u.stats));
  if (totals.level === "over") return { error: totals.message ?? "內容太多，請拆成幾個來源。" };

  const fileRefs: SourceFileRef[] = verified.flatMap((u) => u.refs);
  const sourceType = fileRefs.length > 0 && urls.length > 0 ? "MIXED" : fileRefs.length > 0 ? "PDF" : "URL";

  const source = await prisma.kmSource.create({
    data: {
      title,
      sourceType,
      sourceFileIds: fileRefs.length > 0 ? fileRefs : undefined,
      sourceUrls: urls.length > 0 ? urls : undefined,
      status: "PENDING",
      roleId: session.roleId,
      createdById: session.id,
    },
  });

  revalidatePath("/km/new");
  redirect(`/km/new/${source.id}`);
}
