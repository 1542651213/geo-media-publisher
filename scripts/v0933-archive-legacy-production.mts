import { join } from "node:path";
import { openDatabase } from "@publisher/db";

const dataDirectory = "C:/Users/Administrator/AppData/Roaming/codex-media-publisher/production-data";
const targetTitles = new Set([
  "南京室内环境科普：了解甲醛治理与病媒生物防制的基本流程",
  "无锡室内环境治理科普：甲醛、白蚁与病媒生物防制要点"
]);

const opened = openDatabase(join(dataDirectory, "publisher.db"), join(process.cwd(), "packages", "db", "migrations"));
try {
  const candidates = opened.repository.listArticles({ source: "production" }).filter((article) => !article.contentStudioTaskId && targetTitles.has(article.title));
  const results = candidates.map((article) => opened.repository.archiveArticle(article.id));
  console.log(JSON.stringify({ requested: targetTitles.size, archived: results.map((article) => ({ id: article.id, title: article.title, status: article.status, needsRewrite: article.needsRewrite })) }, null, 2));
} finally {
  opened.db.close();
}
