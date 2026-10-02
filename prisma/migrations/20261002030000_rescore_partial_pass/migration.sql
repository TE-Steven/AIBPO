-- 部分一致改算答對：用每個自動優化版本最近一次完成的測試結果，重算全部／原題／相似題正確率
WITH latest AS (
  SELECT DISTINCT ON ("versionId") "id" AS run_id, "versionId"
  FROM "aibpo_version_test_runs"
  WHERE "status" = 'DONE'
  ORDER BY "versionId", "createdAt" DESC
),
agg AS (
  SELECT
    l."versionId",
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE r."judgeVerdict" IN ('MATCH', 'PARTIAL')) AS pass_all,
    COUNT(*) FILTER (WHERE COALESCE(q."isSimilar", false) = false) AS orig_total,
    COUNT(*) FILTER (WHERE COALESCE(q."isSimilar", false) = false AND r."judgeVerdict" IN ('MATCH', 'PARTIAL')) AS orig_pass,
    COUNT(*) FILTER (WHERE q."isSimilar" = true) AS sim_total,
    COUNT(*) FILTER (WHERE q."isSimilar" = true AND r."judgeVerdict" IN ('MATCH', 'PARTIAL')) AS sim_pass
  FROM latest l
  JOIN "aibpo_version_test_results" r ON r."runId" = l.run_id
  LEFT JOIN "aibpo_optimization_questions" q ON q."id" = r."jobQuestionId"
  GROUP BY l."versionId"
)
UPDATE "aibpo_kb_versions" v
SET
  "scoreAll" = ROUND(100.0 * a.pass_all / a.total),
  "scoreOriginal" = CASE WHEN a.orig_total > 0 THEN ROUND(100.0 * a.orig_pass / a.orig_total) END,
  "scoreSimilar" = CASE WHEN a.sim_total > 0 THEN ROUND(100.0 * a.sim_pass / a.sim_total) END
FROM agg a
WHERE v."id" = a."versionId" AND v."jobId" IS NOT NULL AND v."scoreAll" IS NOT NULL;
