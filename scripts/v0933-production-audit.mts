import { join } from "node:path";
import { openDatabase } from "@publisher/db";

const dataDirectory = "C:/Users/Administrator/AppData/Roaming/codex-media-publisher/production-data";
const opened = openDatabase(join(dataDirectory, "publisher.db"), join(process.cwd(), "packages", "db", "migrations"));
try {
  const production = opened.repository.listArticles({ source: "production" });
  const tasks = opened.repository.listContentStudioTasks().filter((task) => task.type === "production_intent_sample");
  console.log(JSON.stringify({ stats: opened.repository.dashboardStats(), productionArticles: production.length, archived: production.filter((article) => article.status === "archived").map((article) => ({ title: article.title, needsRewrite: article.needsRewrite })), intentSampleTasks: { total: tasks.length, completed: tasks.filter((task) => task.status === "completed").length, failed: tasks.filter((task) => task.status === "failed").length, articles: tasks.filter((task) => task.sourceArticleId).length }, benchmarkArticles: opened.repository.listArticles({ source: "benchmark" }).length }, null, 2));
} finally {
  opened.db.close();
}
