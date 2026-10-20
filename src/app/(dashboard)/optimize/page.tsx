import { redirect } from "next/navigation";

// 自動優化拆成「RAG優化」與「FAQ優化」兩個子選單；舊網址（含以前 LINE 通知裡的連結）一律轉到 RAG優化
export default function OptimizePage() {
  redirect("/optimize/rag");
}
