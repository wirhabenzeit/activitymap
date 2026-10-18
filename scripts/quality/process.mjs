import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { constants } from 'node:os';

export function startCommand(
  command,
  args,
  { cwd, env, log, timeoutMs, signal, echo = true } = {},
) {
  const stream = log ? createWriteStream(log) : null;
  const child = spawn(command, args, {
    cwd,
    env,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let timedOut = false;
  let stopped = false;
  let termination;
  const stop = () => {
    if (stopped || !child.pid) return termination;
    stopped = true;
    const kill = (value) => {
      try {
        process.kill(
          process.platform === 'win32' ? child.pid : -child.pid,
          value,
        );
        return true;
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
        return false;
      }
    };
    if (!kill('SIGTERM')) return;
    // A parent can exit before a TERM-ignoring worker with closed stdio. Keep
    // escalation referenced and await it; child.close alone cannot prove that
    // the owned process group has stopped. This also handles an exited parent.
    termination = new Promise((resolve, reject) => {
      setTimeout(() => {
        try {
          kill('SIGKILL');
          resolve();
        } catch (error) {
          reject(error);
        }
      }, 5000);
    });
    return termination;
  };
  const receive = (data) => {
    output = (output + data).slice(-1024 * 1024);
    stream?.write(data);
    if (echo) process.stdout.write(data);
  };
  child.stdout.on('data', receive);
  child.stderr.on('data', receive);
  const timer =
    timeoutMs &&
    setTimeout(() => {
      timedOut = true;
      stop();
    }, timeoutMs);
  signal?.addEventListener('abort', stop, { once: true });
  if (signal?.aborted) stop();
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code, terminationSignal) =>
      resolve({
        code,
        signal: terminationSignal,
        timedOut,
        output,
        exitCode: timedOut
          ? 124
          : (code ?? 128 + (constants.signals[terminationSignal] ?? 1)),
      }),
    );
  }).finally(async () => {
    clearTimeout(timer);
    await termination;
    signal?.removeEventListener('abort', stop);
    if (stream) await new Promise((resolve) => stream.end(resolve));
  });
  return { child, done, stop };
}

export async function runCommand(command, args, options) {
  const result = await startCommand(command, args, options).done;
  if (result.exitCode !== 0) {
    const error = new Error(
      `${command} failed (${result.timedOut ? 'timeout' : (result.signal ?? result.code)}). See ${options?.log ?? 'output above'}.`,
    );
    error.exitCode = result.exitCode;
    throw error;
  }
  return result.output;
}
