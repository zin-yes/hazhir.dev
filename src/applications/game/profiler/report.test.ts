import { describe, expect, test } from "bun:test";
import { buildEfficiencyLines, buildWorkerMethodRows } from "./metric-names";
import { busyGameScenario, simulateSnapshot } from "./profile-fixtures";
import { buildProfileReport } from "./report";

describe("buildProfileReport", () => {
  const snapshot = simulateSnapshot(busyGameScenario());
  const report = buildProfileReport(snapshot);

  function targetsIn(group: string) {
    return report.targets.filter((target) => target.group === group);
  }

  test("ranks main-thread scopes by self time and leaves out the wrapper aggregate", () => {
    const mainTargets = targetsIn("main-thread");
    const names = mainTargets.map((target) => target.name);
    expect(names[0]).toBe("main.frame.render");
    expect(names).not.toContain("main.frame.callback");

    const rates = mainTargets.map((target) => target.millisecondsPerSecond ?? 0);
    expect(rates).toEqual([...rates].sort((first, second) => second - first));

    // render is 6ms inclusive with 1.5ms nested upload, at 50 frames per second
    expect(mainTargets[0].millisecondsPerSecond).toBeGreaterThan(200);
    expect(mainTargets[0].millisecondsPerSecond).toBeLessThan(250);
    expect(mainTargets[0].frameBudgetSharePercent).toBeGreaterThan(20);
  });

  test("a nested scope is ranked by its own time, not charged to its parent", () => {
    const upload = targetsIn("main-thread").find((target) => target.name === "main.gl.upload");
    expect(upload?.millisecondsPerSecond).toBeGreaterThan(70);
    expect(upload?.millisecondsPerSecond).toBeLessThan(80);
  });

  test("assigns contiguous ranks in group order", () => {
    expect(report.targets.map((target) => target.rank)).toEqual(
      report.targets.map((_, index) => index + 1),
    );
    const groupOrder = report.targets.map((target) => target.group);
    const firstTransfer = groupOrder.indexOf("transfer");
    const firstWorker = groupOrder.indexOf("worker");
    expect(groupOrder.indexOf("main-thread")).toBe(0);
    expect(firstTransfer).toBeGreaterThan(0);
    expect(firstWorker).toBeGreaterThan(firstTransfer);
  });

  test("transfer cost combines postMessage time with the estimated receive clone", () => {
    const transfer = targetsIn("transfer").find((target) => target.name === "mesh.generateMesh");
    expect(transfer).toBeDefined();
    // 25 tasks/s * (77824 + 520000) bytes
    expect(transfer!.bytesPerSecond!).toBeGreaterThan(13.5 * 1024 * 1024);
    expect(transfer!.bytesPerSecond!).toBeLessThan(15.5 * 1024 * 1024);
    // post: 0.35ms * 25/s = 8.75; receive: 520000*25 / (800MB/s) = ~15.5ms/s
    expect(transfer!.millisecondsPerSecond!).toBeGreaterThan(23);
    expect(transfer!.millisecondsPerSecond!).toBeLessThan(26);
    expect(transfer!.note).toContain("receive clone");
  });

  test("worker exec target carries pool utilization and cost per unit of work", () => {
    const exec = targetsIn("worker").find((target) => target.name === "worker.mesh.generateMesh.exec");
    expect(exec?.millisecondsPerSecond).toBeGreaterThan(650);
    expect(exec?.note).toContain("pool utilization");
    expect(exec?.note).toContain("per facesEmitted");

    const sectionNames = targetsIn("worker").map((target) => target.name);
    expect(sectionNames).toContain("worker.mesh.generateMesh.faceLoop");
  });

  test("efficiency lines divide whole-task execution time by counted work", () => {
    const lines = buildEfficiencyLines(buildWorkerMethodRows(snapshot));
    const faces = lines.find((line) => line.counter === "facesEmitted");
    // 28ms per task over 5200 faces
    expect(faces!.nanosecondsPerUnit).toBeCloseTo((28 / 5200) * 1_000_000, -1);
    const blocks = lines.find((line) => line.counter === "blocksScanned");
    expect(blocks!.nanosecondsPerUnit).toBeCloseTo((28 / 32768) * 1_000_000, -1);
  });

  test("memory targets rank by size and include per-attribute mesh bytes", () => {
    const memory = targetsIn("memory");
    expect(memory[0].name).toBe("memory.geometryBytes");
    expect(memory.map((target) => target.name)).toContain("meshes.positions");
    const positions = memory.find((target) => target.name === "meshes.positions");
    expect(positions?.note).toContain("12.0 bytes per vertex");
  });

  test("latency targets are ordered by p95 and carry no CPU rate", () => {
    const latency = targetsIn("latency");
    expect(latency.length).toBeGreaterThan(0);
    expect(latency.every((target) => target.millisecondsPerSecond === null)).toBe(true);
    const p95s = latency.map((target) => target.p95Ms ?? 0);
    expect(p95s).toEqual([...p95s].sort((first, second) => second - first));
  });

  test("gpu frame time becomes a gpu target", () => {
    const gpu = targetsIn("gpu").find((target) => target.name === "gpu.frame");
    expect(gpu?.millisecondsPerSecond).toBeGreaterThan(240);
    expect(gpu?.millisecondsPerSecond).toBeLessThan(260);
  });
});
