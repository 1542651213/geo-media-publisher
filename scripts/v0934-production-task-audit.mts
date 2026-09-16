import { join } from "node:path";
import { openDatabase } from "@publisher/db";

const dataDirectory = "C:/Users/Administrator/AppData/Roaming/codex-media-publisher/production-data";
const opened = openDatabase(join(dataDirectory, "publisher.db"), join(process.cwd(), "packages", "db", "migrations"));

try {
  const tasks = opened.repository.listContentStudioTasks()
    .filter((task) => task.type === "production_intent_sample")
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  console.log(JSON.stringify(tasks.map((task) => ({
    id: task.id,
    status: task.status,
    sourceArticleId: task.sourceArticleId,
    city: task.payload.city ?? task.payload.cities[0] ?? null,
    keyword: task.payload.keyword ?? task.payload.keywords[0] ?? null,
    business: task.payload.business ?? null,
    targetPlatforms: task.payload.targetPlatforms,
    contentGoal: task.payload.contentGoal ?? null,
    contentIntent: task.payload.contentIntent ?? null,
    searchIntent: task.payload.searchIntent ?? null,
    topic: task.payload.topic ?? null,
    promotionStrength: task.payload.promotionStrength ?? null,
    promptVersion: task.payload.promptVersion ?? task.output.promptVersion ?? null,
    providerDiagnostics: task.output.providerDiagnostics ?? null,
    provider: task.provider,
    model: task.model,
    errorMessage: task.errorMessage
  })), null, 2));
} finally {
  opened.db.close();
}
