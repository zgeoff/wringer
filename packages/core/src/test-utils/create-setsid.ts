import { chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// macOS ships perl but no setsid. Like the real command, the shim forks first when it leads a
// process group, because a group leader cannot start a session, and `-w` waits for that child and
// exits with its status.
const shim = `#!/usr/bin/perl
use strict;
use warnings;
use POSIX qw(setsid :sys_wait_h);

my $wait = 0;
if (@ARGV && $ARGV[0] eq '-w') {
  $wait = 1;
  shift @ARGV;
}
die "usage: setsid [-w] command [args...]\\n" unless @ARGV;

if (getpgrp(0) == $$) {
  my $child = fork();
  die "setsid: fork: $!\\n" unless defined $child;
  if ($child) {
    exit 0 unless $wait;
    waitpid($child, 0);
    exit($? & 127 ? 128 + ($? & 127) : $? >> 8);
  }
}

setsid() or die "setsid: $!\\n";
exec { $ARGV[0] } @ARGV or die "setsid: failed to execute $ARGV[0]: $!\\n";
`;

// Returns the host's own setsid when it has one, and else a shim script in the folder.
export async function createSetsid(directory: string): Promise<string> {
  const hostSetsid = Bun.which('setsid');

  if (hostSetsid !== null) {
    return hostSetsid;
  }

  const shimPath = join(directory, 'setsid-shim');

  await writeFile(shimPath, shim);
  await chmod(shimPath, 0o755);

  return shimPath;
}
