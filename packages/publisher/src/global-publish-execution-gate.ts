import type { AppRepository } from "@publisher/db";

/** Serializes all formal PublisherService callers in this Main process. */
export class GlobalPublishExecutionGate {
  private static readonly instances = new WeakMap<AppRepository, GlobalPublishExecutionGate>();
  private tail: Promise<void> = Promise.resolve();
  private halted = false;

  static forRepository(repository: AppRepository): GlobalPublishExecutionGate {
    const existing = this.instances.get(repository);
    if (existing) return existing;
    const created = new GlobalPublishExecutionGate(repository);
    this.instances.set(repository, created);
    return created;
  }

  private constructor(private readonly repository: AppRepository) {}

  async run<T>(jobId: string, operation: () => Promise<T>): Promise<T> {
    const predecessor = this.tail;
    let releaseQueue!: () => void;
    this.tail = new Promise<void>((resolve) => { releaseQueue = resolve; });
    await predecessor;
    let acquired = false;
    let completed = false;
    try {
      if (this.halted) throw Object.assign(new Error("An unresolved timed-out submit still owns the formal publish slot"), { code: "GLOBAL_PUBLISH_UNCERTAIN" });
      this.repository.acquireGlobalFormalPublishExecution(jobId);
      acquired = true;
      const result = await operation();
      completed = true;
      return result;
    } finally {
      if (acquired) {
        const job = this.repository.getJob(jobId);
        const intent = this.repository.getSubmissionIntentByJob(jobId);
        const retain = Boolean(intent && intent.finalSubmitCount >= 1 && (job?.lastErrorCode === "TIMEOUT" && job.status === "NeedsReconciliation" || !completed && ["Submitting", "NeedsReconciliation"].includes(job?.status ?? "")));
        if (retain) {
          this.halted = true;
          this.repository.updateGlobalFormalPublishExecution(jobId, "UNCERTAIN_IN_FLIGHT");
        } else this.repository.releaseGlobalFormalPublishExecution(jobId);
      }
      releaseQueue();
    }
  }
}
