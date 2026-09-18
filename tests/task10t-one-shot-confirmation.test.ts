import { describe, expect, it } from "vitest";
import { OneShotConfirmationCoordinator } from "../apps/desktop/src/main/one-shot-confirmation";

describe("Task10T one-shot confirmation coordinator", () => {
  it("coalesces seven concurrent confirmations for one identity into one execution", async () => {
    const coordinator = new OneShotConfirmationCoordinator();
    let executions = 0;
    let release!: () => void;
    const pending = new Promise<string>((resolve) => { release = () => resolve("committed"); });
    const operation = async (): Promise<string> => { executions += 1; return pending; };

    const results = Array.from({ length: 7 }, () => coordinator.run("task10t-run", operation));
    release();

    await expect(Promise.all(results)).resolves.toEqual(Array.from({ length: 7 }, () => "committed"));
    expect(executions).toBe(1);
  });

  it("allows a later call to observe the repository idempotent result after the first settles", async () => {
    const coordinator = new OneShotConfirmationCoordinator();
    let executions = 0;

    await expect(coordinator.run("task10t-run", async () => { executions += 1; return "created"; })).resolves.toBe("created");
    await expect(coordinator.run("task10t-run", async () => { executions += 1; return "duplicate"; })).resolves.toBe("duplicate");
    expect(executions).toBe(2);
  });
});
