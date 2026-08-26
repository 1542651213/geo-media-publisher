import { join } from "node:path";
import { homedir } from "node:os";
import { openDatabase } from "@publisher/db";

const dataDir = join(homedir(), ".codex-media-publisher");
openDatabase(join(dataDir, "publisher.db"), join(process.cwd(), "packages", "db", "migrations"));
console.log(`Database migrated: ${join(dataDir, "publisher.db")}`);
