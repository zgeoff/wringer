// The failure of a database client such as psql, with its SQLSTATE under `errno`, where Bun.SQL's
// errors keep it, so one classifier reads both.
export class DatabaseClientError extends Error {
  readonly errno: string | null;

  constructor(message: string, errno: string | null) {
    super(message);

    this.name = 'DatabaseClientError';
    this.errno = errno;
  }
}
