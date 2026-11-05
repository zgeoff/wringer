import type { z } from 'zod';
import type { RunView } from './build-run-view.ts';
import type { RunPaths } from './build-state-paths.ts';
import type { StatePort } from './create-file-state.ts';
import type { Evidence } from './envelope.ts';
import type { Access, Host } from './host.ts';
import type { FingerprintHost } from './read-fingerprint.ts';
import type { Endpoints, RunID } from './run-events.ts';
import type { ProcessResult } from './run-process.ts';

export type Effect = 'read' | 'write';

export type Emit = (event: string, data: unknown) => void;

export interface EvidenceWriter {
  readonly directory: string;
  readonly writeFile: (
    kind: string,
    name: string,
    content: string | Uint8Array,
  ) => Promise<Evidence>;
  readonly addFile: (kind: string, path: string) => Promise<Evidence>;
}

export interface ExecOptions {
  readonly stdin?: string | undefined;
}

export type RepoExec = (argv: readonly string[], options?: ExecOptions) => Promise<ProcessResult>;

export type DriverExec = (
  argv: readonly string[],
  effect: Effect,
  options?: ExecOptions,
) => Promise<ProcessResult>;

export interface ChildLog {
  readonly path: string;
}

export interface RunHandle {
  readonly id: string;
  readonly paths: RunPaths;
  readonly childLog: (name: string) => ChildLog;
}

export interface DriverConfigContext {
  readonly target: string;
  readonly endpoints: Endpoints;
  readonly run: RunHandle;
}

export interface ServiceCaller {
  readonly call: (method: string, args: unknown) => Promise<unknown>;
}

// What a driver's client, commands and checks get on one target: the repo-wide options, the
// target's parsed config, and the effect-checked exec and services core hands it.
export interface DriverSession<Options, TargetConfig> {
  readonly target: string;
  readonly access: Access;
  readonly options: Options;
  readonly config: TargetConfig;
  readonly endpoints: Endpoints;
  readonly run: RunHandle;
  readonly exec: DriverExec;
  readonly evidence: EvidenceWriter;
  readonly signal: AbortSignal;
  readonly service: (name: string) => ServiceCaller;
}

export interface ClientCall<Args, Result> {
  readonly effect: (args: Args) => Effect;
  readonly describe: (args: Args) => string;
  readonly run: (args: Args) => Promise<Result>;
}

// Core hands each driver this function to wrap its client calls. A wrapped call checks its effect
// against the target's access before it runs.
export type Fence = <Args, Result>(
  call: ClientCall<Args, Result>,
) => (args: Args) => Promise<Result>;

export interface ServiceContext<Options, TargetConfig> {
  readonly target: string;
  readonly access: Access;
  readonly options: Options;
  readonly config: TargetConfig;
  readonly endpoints: Endpoints;
  readonly run: RunHandle;
  readonly host: Host;
  readonly exec: DriverExec;
  readonly signal: AbortSignal;
}

export interface ServiceInstance {
  readonly methods: Readonly<Record<string, (args: unknown) => Promise<unknown>>>;
  readonly stop: () => Promise<void>;
}

export interface ServiceDefinition<Options, TargetConfig> {
  readonly start: (ctx: ServiceContext<Options, TargetConfig>) => Promise<ServiceInstance>;
}

export interface CommandShape<Args, Data> {
  readonly path: readonly string[];
  readonly summary: string;
  readonly args: z.ZodType<Args>;
  readonly positionals?: readonly string[] | undefined;
  readonly data: z.ZodType<Data>;
  readonly effect?: Effect | undefined;
  readonly needsRun?: boolean | undefined;
  readonly needsDoctor?: boolean | undefined;
  readonly timeoutMs?: number | undefined;
}

// A command with its argument and data types erased, as the registry and the CLI adapter see it. A
// command with `decideEffect` reads or writes by its arguments, so its `effect` is only a default.
export type CommandInfo = CommandShape<unknown, unknown> & { readonly decideEffect?: unknown };

export interface DriverCommandContext<Options, TargetConfig, Client> {
  readonly session: DriverSession<Options, TargetConfig>;
  readonly client: Client;
  readonly feature: string | null;
  readonly emit: Emit;
}

export interface DriverCommandSpec<Args, Data, Options, TargetConfig, Client> extends CommandShape<
  Args,
  Data
> {
  readonly decideEffect?: ((args: Args, config: TargetConfig) => Effect) | undefined;
  readonly run: (
    args: Args,
    ctx: DriverCommandContext<Options, TargetConfig, Client>,
  ) => Promise<Data>;
}

export type ArgsResult<Prepared> =
  | { readonly ok: true; readonly prepared: Prepared }
  | { readonly ok: false; readonly message: string };

export interface PreparedDriverCommand<Options, TargetConfig, Client> {
  readonly decideEffect: (config: TargetConfig) => Effect;
  readonly run: (ctx: DriverCommandContext<Options, TargetConfig, Client>) => Promise<unknown>;
}

// One driver command with its own argument types closed over, so a driver's commands share one
// array type.
export interface DriverCommand<Options, TargetConfig, Client> {
  readonly info: CommandInfo;
  readonly prepare: (
    raw: unknown,
  ) => ArgsResult<PreparedDriverCommand<Options, TargetConfig, Client>>;
}

export type DriverCommandHelper<Options, TargetConfig, Client> = <Args, Data>(
  spec: DriverCommandSpec<Args, Data, Options, TargetConfig, Client>,
) => DriverCommand<Options, TargetConfig, Client>;

export interface DriverCheckDefinition<Options, TargetConfig, Client> {
  readonly name: string;
  readonly timeoutMs: number;
  readonly run: (ctx: DriverCommandContext<Options, TargetConfig, Client>) => Promise<void>;
}

export interface SessionParts {
  readonly target: string;
  readonly access: Access;
  readonly endpoints: Endpoints;
  readonly run: RunHandle;
  readonly exec: DriverExec;
  readonly evidence: EvidenceWriter;
  readonly signal: AbortSignal;
  readonly fence: Fence;
  readonly service: (name: string) => ServiceCaller;
}

export interface ServiceParts {
  readonly target: string;
  readonly access: Access;
  readonly endpoints: Endpoints;
  readonly run: RunHandle;
  readonly host: Host;
  readonly exec: DriverExec;
  readonly signal: AbortSignal;
}

export interface PreparedRun {
  readonly effect: Effect;
  readonly run: (feature: string | null, emit: Emit) => Promise<unknown>;
}

export interface RunnableCheck {
  readonly name: string;
  readonly timeoutMs: number;
  readonly run: (feature: string | null, emit: Emit) => Promise<void>;
}

export interface OpenedDriver {
  readonly client: unknown;
  readonly checks: readonly RunnableCheck[];
  readonly prepare: (pathKey: string, raw: unknown) => ArgsResult<PreparedRun>;
}

export interface ConfiguredDriver {
  readonly open: (parts: SessionParts) => OpenedDriver;
  readonly startService: (name: string, parts: ServiceParts) => Promise<ServiceInstance>;
}

// Phantom types that only the type checker reads: the client a repo's code gets, and the config a
// target passes.
export interface DriverTypes<Client, ConfigInput> {
  readonly client: Client;
  readonly config: ConfigInput;
}

// A driver as a repo lists it, bound to the repo-wide options, with its own types closed over.
export interface Driver<Name extends string, Client, ConfigInput> {
  readonly kind: 'driver';
  readonly name: Name;
  readonly commands: readonly CommandInfo[];
  readonly serviceNames: readonly string[];
  readonly configure: (input: unknown) => ArgsResult<ConfiguredDriver>;
  readonly types?: DriverTypes<Client, ConfigInput>;
}

export type AnyDriver = Driver<string, unknown, unknown>;

export type AnyDrivers = readonly AnyDriver[];

export type DriverClients<Ds extends AnyDrivers> = {
  readonly [D in Ds[number] as D['name']]: D extends Driver<string, infer Client, unknown>
    ? Client
    : never;
};

export type DriverConfigs<Ds extends AnyDrivers> = {
  readonly [D in Ds[number] as D['name']]?: (
    ctx: DriverConfigContext,
  ) => D extends Driver<string, unknown, infer ConfigInput> ? ConfigInput : never;
};

export interface DriveContext<Ds extends AnyDrivers = AnyDrivers> {
  readonly target: string;
  readonly access: Access;
  readonly feature: string | null;
  readonly endpoints: Endpoints;
  readonly drivers: DriverClients<Ds>;
  readonly exec: RepoExec;
  readonly evidence: EvidenceWriter;
  readonly signal: AbortSignal;
  readonly emit: Emit;
}

export interface CommandSpec<Args, Data, Ds extends AnyDrivers = AnyDrivers> extends CommandShape<
  Args,
  Data
> {
  readonly decideEffect?: ((args: Args) => Effect) | undefined;
  readonly run: (args: Args, ctx: DriveContext<Ds>) => Promise<Data>;
}

export interface ActionDefinition<Input, Data, Ds extends AnyDrivers = AnyDrivers> {
  readonly name: string;
  readonly summary: string;
  readonly effect: Effect;
  readonly targets?: readonly string[] | undefined;
  readonly input: z.ZodType<Input>;
  readonly data: z.ZodType<Data>;
  readonly timeoutMs?: number | undefined;
  readonly run: (input: Input, ctx: DriveContext<Ds>) => Promise<Data>;
}

export interface CheckDefinition<Input, Data, Ds extends AnyDrivers = AnyDrivers> {
  readonly name: string;
  readonly input: z.ZodType<Input>;
  readonly data: z.ZodType<Data>;
  readonly timeoutMs: number;
  readonly run: (input: Input, ctx: DriveContext<Ds>) => Promise<Data>;
}

export interface FeatureDefinition {
  readonly name: string;
  readonly summary: string;
  readonly paths: readonly string[];
}

export interface UploadRequest {
  readonly path: string;
  readonly kind: string;
  readonly sha256: string;
}

export interface HookHandlers {
  readonly upload: (file: UploadRequest) => Promise<string>;
}

export interface LaunchContext {
  readonly runDirectory: string;
}

export interface LaunchPlan {
  readonly command: readonly string[];
  readonly env?: Readonly<Record<string, string>> | undefined;
  readonly cwd?: string | undefined;
  readonly ready: (line: Readonly<Record<string, unknown>>) => Endpoints | null;
  readonly stop?: readonly string[] | undefined;
}

interface TargetBase<Ds extends AnyDrivers> {
  readonly access: Access;
  readonly refusalHint?: string | undefined;
  readonly host: Host;
  readonly drivers?: DriverConfigs<Ds> | undefined;
}

export interface EndpointsContext {
  readonly target: string;
}

export interface LaunchTarget<Ds extends AnyDrivers> extends TargetBase<Ds> {
  readonly mode: 'launch';
  readonly launch: (ctx: LaunchContext) => LaunchPlan;
  readonly endpoints?: never;
}

export interface AttachTarget<Ds extends AnyDrivers> extends TargetBase<Ds> {
  readonly mode: 'attach';
  readonly endpoints?: ((ctx: EndpointsContext) => Endpoints | Promise<Endpoints>) | undefined;
  readonly launch?: never;
}

export type TargetDefinition<Ds extends AnyDrivers = AnyDrivers> =
  | LaunchTarget<Ds>
  | AttachTarget<Ds>;

export interface Drive {
  readonly ctx: DriveContext;
  readonly drivers: ReadonlyMap<string, OpenedDriver>;
  readonly evidence: readonly Evidence[];
}

export interface BuiltinContext {
  readonly wringer: Wringer;
  readonly state: StatePort;
  readonly session: Session;
  readonly stateDir: string;
  readonly targetName: string;
  readonly target: TargetDefinition;
  readonly run: RunView | undefined;
  readonly feature: string | null;
  readonly signal: AbortSignal;
  readonly now: () => Date;
  readonly emit: Emit;
  readonly openDrive: (access: Access, signal?: AbortSignal) => Drive;

  // A lifecycle command names the run it started, reused or stopped while it holds the target's
  // lock, and its envelope belongs to that run, whatever the pointers say once the lock is free.
  readonly bindRun: (runID: RunID) => void;
}

export interface BuiltinCommandSpec<Args, Data> extends CommandShape<Args, Data> {
  readonly run: (args: Args, ctx: BuiltinContext) => Promise<Data>;
}

export interface PreparedCommand<Ctx> {
  readonly effect: Effect;
  readonly run: (ctx: Ctx) => Promise<unknown>;
}

export type RegisteredCommand =
  | {
      readonly kind: 'repo';
      readonly info: CommandInfo;
      readonly targets: readonly string[] | undefined;
      readonly prepare: (raw: unknown) => ArgsResult<PreparedCommand<DriveContext>>;
    }
  | {
      readonly kind: 'builtin';
      readonly info: CommandInfo;
      readonly prepare: (raw: unknown) => ArgsResult<PreparedCommand<BuiltinContext>>;
    }
  | { readonly kind: 'driver'; readonly info: CommandInfo; readonly driver: string };

export interface RunnableRepoCheck {
  readonly name: string;
  readonly timeoutMs: number;
  readonly run: (ctx: DriveContext) => Promise<void>;
}

export interface Wringer {
  readonly name: string;
  readonly stateDir: string;
  readonly drivers: AnyDrivers;
  readonly targets: ReadonlyMap<string, TargetDefinition>;
  readonly commands: ReadonlyMap<string, RegisteredCommand>;
  readonly checks: readonly RunnableRepoCheck[];
  readonly features: readonly FeatureDefinition[];
  readonly hooks: Partial<HookHandlers>;
}

export interface SupervisorStartRequest {
  readonly runID: string;
  readonly target: string;
}

export interface SupervisorStarter {
  readonly start: (request: SupervisorStartRequest) => Promise<void>;
}

export interface OutputPort {
  readonly writeLine: (line: string) => void;
}

// The disk operations that keep a command's evidence in the run's folder.
export interface EvidenceFiles {
  readonly createDirectory: (path: string) => Promise<void>;

  // False, with nothing written, when the path exists.
  readonly writeNewFile: (path: string, bytes: Uint8Array) => Promise<boolean>;
  readonly readBytes: (path: string) => Promise<Uint8Array>;
}

// Everything a command reads from or writes to the repo: its git, the files a command names, and
// its evidence.
export interface RepoHost extends FingerprintHost, EvidenceFiles {
  readonly readText: (path: string) => Promise<string>;
}

// What the CLI adapter knows about one invocation.
export interface Session {
  readonly root: string;
  readonly state: StatePort;
  readonly repoHost: RepoHost;
  readonly target?: string | undefined;
  readonly feature?: string | undefined;
  readonly timeoutMs?: number | undefined;
  readonly output: OutputPort;
  readonly supervisor: SupervisorStarter;
  readonly now?: (() => Date) | undefined;
}
