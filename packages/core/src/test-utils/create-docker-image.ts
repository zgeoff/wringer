export interface DockerImage {
  readonly tag: string;
  readonly dockerfile: string;
}

const builds = new Map<string, Promise<void>>();

// Builds each tag once per process, and callers share a build in flight. The build has no timeout
// and no signal: killing a BuildKit build mid-way can corrupt its snapshots for every later build.
export function createDockerImage(image: DockerImage): Promise<void> {
  const pending = builds.get(image.tag);

  if (pending !== undefined) {
    return pending;
  }

  const build = runForgettingFailure(image);

  builds.set(image.tag, build);

  return build;
}

async function runForgettingFailure(image: DockerImage): Promise<void> {
  try {
    await runDockerBuild(image);
  } catch (error) {
    builds.delete(image.tag);
    throw error;
  }
}

async function runDockerBuild(image: DockerImage): Promise<void> {
  const build = Bun.spawn(['docker', 'build', '--quiet', '--tag', image.tag, '-'], {
    stdin: new TextEncoder().encode(image.dockerfile),
    stdout: 'ignore',
    stderr: 'pipe',
  });

  const [exitCode, stderr] = await Promise.all([build.exited, new Response(build.stderr).text()]);

  if (exitCode !== 0) {
    throw new Error(`docker build of ${image.tag} failed: ${stderr}`);
  }
}
