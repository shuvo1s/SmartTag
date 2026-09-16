/**
 * Human-readable production job number: "PJ-20260916-000123".
 *
 * The number is only a label — the job's identity is its database id. It is generated on the
 * server from a per-organization, per-day counter under a row lock, so two jobs created at the
 * same moment can never receive the same number, and a number is never reused.
 */
export const JOB_NUMBER_PREFIX = 'PJ' as const;
export const JOB_NUMBER_PATTERN = /^PJ-\d{8}-\d{6}$/;

export function formatJobNumber(day: string, counter: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new RangeError('the day of a job number is an ISO calendar date');
  }
  if (!Number.isInteger(counter) || counter < 1 || counter > 999_999) {
    throw new RangeError('a day holds at most 999,999 production jobs');
  }
  return `${JOB_NUMBER_PREFIX}-${day.replaceAll('-', '')}-${String(counter).padStart(6, '0')}`;
}

/** The day part of a job number as an ISO date, or null when the number is not one of ours. */
export function jobNumberDay(jobNumber: string): string | null {
  if (!JOB_NUMBER_PATTERN.test(jobNumber)) return null;
  const digits = jobNumber.slice(3, 11);
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

/** The UTC day a job number is allocated for. */
export function jobNumberDayFor(now: Date): string {
  return now.toISOString().slice(0, 10);
}
