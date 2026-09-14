import { forwardToApi } from '@/lib/api-proxy';

/** Streams every `/api/v1/*` request to the API at runtime (see src/lib/api-proxy.ts). */
export const dynamic = 'force-dynamic';

function handler(request: Request): Promise<Response> {
  return forwardToApi(request);
}

export {
  handler as DELETE,
  handler as GET,
  handler as HEAD,
  handler as OPTIONS,
  handler as PATCH,
  handler as POST,
  handler as PUT,
};
