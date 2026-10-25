import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, constants } from "node:fs/promises";
import { platform } from "node:os";
import { performance } from "node:perf_hooks";
import { text } from "node:stream/consumers";

/** How a child process ended and how long it took, in milliseconds. */
export interface Ran {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly milliseconds: number;
}

/** Runs `command` in `cwd` to its end. */
export async function run(command: string, args: readonly string[], cwd: string): Promise<Ran> {
  const start = performance.now();
  const child = spawn(command, args, { cwd });
  const [stdout, stderr] = await Promise.all([
    text(child.stdout),
    text(child.stderr),
    once(child, "close"),
  ]);
  return { exitCode: child.exitCode, stdout, stderr, milliseconds: performance.now() - start };
}

/** Runs `command` and rejects, with its output, unless it exits with 0. */
export async function succeeded(
  command: string,
  args: readonly string[],
  cwd: string,
): Promise<Ran> {
  const ran = await run(command, args, cwd);
  if (ran.exitCode !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} exited ${String(ran.exitCode)}:\n${ran.stdout}${ran.stderr}`,
    );
  }
  return ran;
}

const TIME = "/usr/bin/time";
const KILOBYTE = 1024;

/** The line in which `/usr/bin/time` reports the peak memory of a command, on each system. */
const peakFormats: Readonly<Record<string, { flag: string; pattern: RegExp; scale: number }>> = {
  darwin: { flag: "-l", pattern: /^(?<value>\d+) +maximum resident set size$/v, scale: 1 },
  linux: {
    flag: "-v",
    pattern: /^Maximum resident set size \(kbytes\): (?<value>\d+)$/v,
    scale: KILOBYTE,
  },
};

/** A command's run with the peak resident memory, in bytes, of it and its children when known. */
export interface Measured extends Ran {
  readonly peakBytes: number | null;
}

/**
 * Runs `command` under `/usr/bin/time` where it reports peak memory. The peak is the largest of the
 * process and the children it waited for, such as TypeScript's content mapper process.
 */
export async function measured(
  command: string,
  args: readonly string[],
  cwd: string,
): Promise<Measured> {
  const format = peakFormats[platform()];
  const timed =
    format !== undefined &&
    (await access(TIME, constants.X_OK).then(
      () => true,
      () => false,
    ));
  if (format === undefined || !timed) {
    return { ...(await run(command, args, cwd)), peakBytes: null };
  }
  const ran = await run(TIME, [format.flag, command, ...args], cwd);
  const peak = ran.stderr
    .split("\n")
    .map((line) => format.pattern.exec(line.trim())?.groups?.["value"])
    .find((value) => value !== undefined);
  return { ...ran, peakBytes: peak === undefined ? null : Number(peak) * format.scale };
}
