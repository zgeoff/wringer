import { join } from 'node:path';
import { WringerError, createDirectory, defineDriver, findOwnValue } from '@wringer/core';
import type { DriverSession, Fence, RunHandle } from '@wringer/core';
import { z } from 'zod';
import { appendWholeText } from './append-whole-text.ts';
import { streamRecordSchema } from './build-stream-slice.ts';
import type { StreamSlice } from './build-stream-slice.ts';
import { readFileFrom } from './read-file-from.ts';
import { readStreamSlice } from './read-stream-slice.ts';
import type { StreamSliceRequest } from './read-stream-slice.ts';
import {
  sourceStatusSchema,
  startStreamRecorder,
  streamSourceSchema,
} from './start-stream-recorder.ts';
import type { StreamSource } from './start-stream-recorder.ts';
import { waitOrAbort } from './wait-or-abort.ts';

const streamNameSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/u);

// The recorder caps a record's line at 4096 characters, which JSON escaping can grow to about
// 24 KiB, so a smaller slice could hold no whole record and never advance its cursor.
const minimumSliceBytes = 32 * 1024;

export const streamReadSchema = z.strictObject({
  name: streamNameSchema,
  from: z.number().int().nonnegative().optional(),
  maxBytes: z.number().int().min(minimumSliceBytes).optional(),
});

export const streamSliceSchema = z.strictObject({
  name: z.string(),
  records: z.array(streamRecordSchema),
  cursor: z.number().int().nonnegative(),
  more: z.boolean(),
});

const optionsSchema = z.strictObject({
  maxBytes: z
    .number()
    .int()
    .min(64 * 1024)
    .default(64 * 1024),
});

const targetConfigSchema = z.strictObject({
  sources: z.record(streamNameSchema, streamSourceSchema).optional(),
});

const statusListSchema = z.array(sourceStatusSchema);

// Records a target's logs for the whole run, in the run's supervisor, and reads them back from a
// cursor. A read with no `from` starts at the cursor that `use` last marked, so an agent reads only
// what its own steps logged.
export const stream = defineDriver({
  name: 'stream',
  options: optionsSchema,
  targetConfig: targetConfigSchema,
  services: {
    recorder: {
      start: async (ctx) => {
        const recorder = await startStreamRecorder({
          sources: pickSources(ctx.config.sources, ctx.run),
          directory: ctx.run.paths.streams,
          host: ctx.host,
          access: ctx.access,
          now: () => new Date(),
          createDirectory,
          appendText: appendWholeText,
          readFileFrom,
          wait: waitOrAbort,
          pendingLimit: 10_000,
        });

        return {
          methods: { status: () => Promise.resolve(recorder.status()) },
          stop: recorder.stop,
        };
      },
    },
  },
  client: (session, fence) => createStreamClient(session, fence, readStreamSlice),
  commands: (command) => [
    command({
      path: ['stream', 'read'],
      summary: 'Read a stream from the cursor that `use` marked, or from --from',
      args: streamReadSchema,
      positionals: ['name'],
      data: streamSliceSchema,
      effect: 'read',
      run: (args, ctx) => ctx.client.read(args),
    }),
  ],
  checks: [
    {
      name: 'recording',
      timeoutMs: 5000,
      run: async (ctx) => {
        const answer = await ctx.session.service('recorder').call('status', null);

        const statuses = statusListSchema.parse(answer);
        const stopped = statuses.filter((status) => status.state !== 'running');

        if (stopped.length > 0) {
          throw new WringerError('check-failed', {
            message: `These streams stopped recording: ${stopped.map((status) => `${status.name} (${status.detail ?? status.state})`).join(', ')}.`,
          });
        }
      },
    },
  ],
});

// With no sources, the driver records the app the run launched.
function pickSources(
  sources: Readonly<Record<string, StreamSource>> | undefined,
  run: RunHandle,
): Readonly<Record<string, StreamSource>> {
  return sources ?? { app: { file: run.childLog('app').path } };
}

type StreamSession = DriverSession<
  z.infer<typeof optionsSchema>,
  z.infer<typeof targetConfigSchema>
>;

type ReadSlice = (request: StreamSliceRequest) => Promise<StreamSlice>;

export type StreamRead = z.input<typeof streamReadSchema>;

export type StreamSliceData = z.infer<typeof streamSliceSchema>;

export interface StreamClient {
  readonly read: (request: StreamRead) => Promise<StreamSliceData>;
}

function createStreamClient(
  session: StreamSession,
  fence: Fence,
  readSlice: ReadSlice,
): StreamClient {
  return {
    read: fence({
      effect: () => 'read',
      describe: (request: StreamRead) => `stream read ${request.name}`,
      run: async (request) => {
        const parsed = streamReadSchema.parse(request);
        const sources = pickSources(session.config.sources, session.run);

        if (!Object.hasOwn(sources, parsed.name)) {
          throw new WringerError('usage', {
            message: `Target ${session.target} records no stream named ${parsed.name}.`,
            hint: `Read one of: ${Object.keys(sources).join(', ')}.`,
          });
        }

        const slice = await readSlice({
          path: join(session.run.paths.streams, `${parsed.name}.ndjson`),
          from: parsed.from ?? findOwnValue(session.cursors, parsed.name) ?? 0,
          maxBytes: Math.min(parsed.maxBytes ?? session.options.maxBytes, session.options.maxBytes),
        });

        return { name: parsed.name, ...slice, records: [...slice.records] };
      },
    }),
  };
}
