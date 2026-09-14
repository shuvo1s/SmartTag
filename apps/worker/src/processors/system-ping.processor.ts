import { JOB_NAMES, SystemPingJobSchema } from '@smarttag/shared-types';
import { defineJobHandler } from '../job-registry';

/**
 * Connectivity check for the job pipeline (api → Redis → worker). Rendering, VDP and export
 * processors are added in later phases using the same registry.
 */
export const systemPingHandler = defineJobHandler({
  name: JOB_NAMES.SYSTEM_PING,
  schema: SystemPingJobSchema,
  handle: (payload, context) => {
    context.logger.info(
      { message: payload.message, requestedAt: payload.requestedAt },
      'system ping received',
    );
    return Promise.resolve({ receivedAt: new Date().toISOString(), echo: payload.message });
  },
});
