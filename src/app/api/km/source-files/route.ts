import type { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSession } from "@/lib/session";
import { deleteUploadedFiles, processSourceFile, signUpload, UploadError, verifyUpload, type SignedUpload } from "@/lib/sourceUpload";

export const dynamic = "force-dynamic";

// 建立來源時一次上傳一個檔案（大檔案不會塞爆單一請求）。這個路徑不經過 proxy，避免 proxy 只暫存前 10MB 而截斷檔案。

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

async function currentUser(): Promise<{ id: string; roleId: string } | null> {
  const session = await getSession();
  return session && session.kind === "user" ? { id: session.id, roleId: session.roleId } : null;
}

async function currentUserId(): Promise<string | null> {
  return (await currentUser())?.id ?? null;
}

// POST multipart：file、imagesUsed（這個來源前面的檔案已附上的圖片張數）、purpose（questions＝題目來源）
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return jsonError("請先登入。", 401);
  const userId = user.id;

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0) return jsonError("沒有收到檔案。", 400);
  const imagesUsed = Number(form?.get("imagesUsed") ?? 0) || 0;
  const purpose = form?.get("purpose") === "questions" ? "questions" : "knowledge";

  // 題目來源可能要先跑好幾分鐘的 AI 萃取：改成串流回應（每行一個 JSON），邊做邊回報進度，最後一行是結果或錯誤
  if (purpose === "questions") {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (obj: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
        // 某個步驟跑很久時也定期送一行，避免連線被中間的代理當成閒置切斷
        const heartbeat = setInterval(() => send({ ping: true }), 15_000);
        try {
          const uploaded = await processSourceFile(file, imagesUsed, { purpose, roleId: user.roleId, onProgress: (p) => send({ progress: p }) });
          send({ ...signUpload(userId, uploaded), stats: uploaded.stats });
        } catch (err) {
          send({ error: uploadErrorMessage(err, file.name) });
        } finally {
          clearInterval(heartbeat);
          controller.close();
        }
      },
    });
    return new Response(stream, {
      headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" },
    });
  }

  try {
    const uploaded = await processSourceFile(file, imagesUsed, { purpose, roleId: user.roleId });
    return Response.json({ ...signUpload(userId, uploaded), stats: uploaded.stats });
  } catch (err) {
    const status = err instanceof UploadError ? 400 : err instanceof Anthropic.APIError ? 502 : 500;
    return jsonError(uploadErrorMessage(err, file.name), status);
  }
}

function uploadErrorMessage(err: unknown, fileName: string): string {
  if (err instanceof UploadError) return err.message;
  if (err instanceof Anthropic.APIError) return `「${fileName}」上傳到 Claude 失敗：${err.message}`;
  return `「${fileName}」處理失敗：${err instanceof Error ? err.message : "未知錯誤"}`;
}

// DELETE JSON { uploads: SignedUpload[] }：取消建立時刪掉已上傳的檔案（只能刪自己上傳、簽章正確的）
export async function DELETE(req: NextRequest) {
  const userId = await currentUserId();
  if (!userId) return jsonError("請先登入。", 401);
  const body = (await req.json().catch(() => ({}))) as { uploads?: SignedUpload[] };
  const refs = (body.uploads ?? []).flatMap((u) => verifyUpload(userId, u)?.refs ?? []);
  await deleteUploadedFiles(refs);
  return Response.json({ deleted: refs.length });
}
