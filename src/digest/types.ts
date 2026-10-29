export type DigestStatus = 'ok' | 'retry' | 'fail';

/** Times retain their source offsets; first/last are chronological, with later lines winning ties. */
export type DigestRow = {
  job: string;
  owner: string | null;
  runs: number;
  retries: number;
  lastStatus: DigestStatus;
  lastError: string | null;
  firstAt: string;
  lastAt: string;
  hasFailure: boolean;
};

export type DigestCounts = {
  ok: number;
  retry: number;
  fail: number;
};

/** Counts cover all valid events, not final job statuses; blank lines are not invalid. */
export type DigestResult = {
  night: string;
  found: boolean;
  rows: DigestRow[];
  counts: DigestCounts;
  invalidLines: number;
};

/**
 * Synchronously reads a calendar-valid YYYY-MM-DD night; unsafe names throw RangeError.
 * Missing files return found:false with empty rows and zero counts; other I/O errors throw.
 * Rows sort by job using code-unit order. Runs count valid events; retries count retry events.
 * Owner and status follow the latest event. LastError retains the latest supplied string error,
 * or null if none, even after success. HasFailure records any fail, including recovered jobs.
 * Invalid JSON or event structure is counted and skipped without aborting the night.
 */
export type ReadNight = (runsDir: string, night: string) => DigestResult;