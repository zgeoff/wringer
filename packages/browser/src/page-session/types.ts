import type { PageResult } from '../page-service-contract.ts';

// What the driver reports of a download that a click or a key press started.
export type DownloadInfo = NonNullable<PageResult<'click'>['download']>;
