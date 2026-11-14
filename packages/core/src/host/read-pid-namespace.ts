import { readlinkSync } from 'node:fs';
import { isErrorCode } from '../is-error-code.ts';

const namespacePattern = /\[(?<id>\d+)\]/v;

// A PID names a process only inside its PID namespace, so two containers that share a folder can
// both run a process 4100. A host with no `/proc`, such as macOS, has the one namespace `host`.
export function readPIDNamespace(): string {
  try {
    return namespacePattern.exec(readlinkSync('/proc/self/ns/pid'))?.groups?.['id'] ?? 'host';
  } catch (error) {
    if (isErrorCode(error, 'ENOENT') || isErrorCode(error, 'EACCES')) {
      return 'host';
    }

    throw error;
  }
}
