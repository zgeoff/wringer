import { expect, onTestFinished, test } from 'bun:test';
import { $ } from 'bun';
import { createDockerImage } from './create-docker-image.ts';

test('it builds the image under its tag', async () => {
  const tag = 'wringer-test-create-docker-image:built';

  onTestFinished(() => {
    Bun.spawnSync(['docker', 'rmi', '--force', tag]);
  });

  await createDockerImage({ tag, dockerfile: 'FROM alpine:3.22\nLABEL case=built\n' });

  const inspected = await $`docker image inspect --format '{{index .Config.Labels "case"}}' ${tag}`
    .quiet()
    .text();

  expect(inspected).toBe('built\n');
});

test('it gives callers that ask for a tag while it builds the same build', async () => {
  const tag = 'wringer-test-create-docker-image:shared';
  const image = { tag, dockerfile: 'FROM alpine:3.22\nLABEL case=shared\n' };

  onTestFinished(() => {
    Bun.spawnSync(['docker', 'rmi', '--force', tag]);
  });

  const first = createDockerImage(image);
  const second = createDockerImage(image);

  await first;

  expect(second).toBe(first);
});

test('it rejects with the reason when the build fails', () => {
  const image = {
    tag: 'wringer-test-create-docker-image:failed',
    dockerfile: 'FROM alpine:3.22\nRUN false\n',
  };

  expect(createDockerImage(image)).rejects.toThrowWithMessage(
    Error,
    /^docker build of wringer-test-create-docker-image:failed failed: .*exit code: 1/su,
  );
});

test('it builds a tag whose build failed again on the next call', async () => {
  const image = {
    tag: 'wringer-test-create-docker-image:retried',
    dockerfile: 'FROM alpine:3.22\nRUN false\n',
  };

  const first = createDockerImage(image);

  await Promise.allSettled([first]);

  const second = createDockerImage(image);

  await Promise.allSettled([second]);

  expect(second).not.toBe(first);
});
