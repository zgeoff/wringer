import type { Host } from './host.ts';
import { runProcess } from './run-process.ts';

export function local(): Host {
  return {
    kind: 'local',
    run: (request) =>
      runProcess({ argv: request.argv, stdin: request.stdin, signal: request.signal }),
  };
}
