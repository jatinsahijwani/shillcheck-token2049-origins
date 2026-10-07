// Tries each model in order when a call fails before any output (HTTP 429/5xx or a network error), so one overloaded
// model does not fail a paid Task. A failure after streaming has started is not retried on another model.
const retryable = (error: any): boolean => {
  const status = error?.statusCode ?? error?.status ?? error?.cause?.statusCode;
  if (typeof status === 'number') return status === 429 || status >= 500;
  return true; // network / unknown errors before a response
};
export function createFallbackModel(models: any[], perAttemptTimeoutMs = 30000): any {
  if (models.length === 0) throw new Error('createFallbackModel needs at least one model');
  const first = models[0];
  const attempt = async (method: 'doGenerate' | 'doStream', options: any) => {
    let last: unknown;
    for (const model of models) {
      try {
        // A provider that accepts the request but never answers is treated like an overloaded one.
        let timer: any;
        const stalled = new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('model did not respond in time'), { statusCode: 504 })), perAttemptTimeoutMs); });
        try { return await Promise.race([model[method](options), stalled]); } finally { clearTimeout(timer); }
      } catch (error) {
        last = error;
        if (!retryable(error) || options?.abortSignal?.aborted) throw error;
      }
    }
    throw last;
  };
  return {
    specificationVersion: first.specificationVersion,
    provider: first.provider,
    modelId: first.modelId,
    supportedUrls: first.supportedUrls ?? {},
    doGenerate: (options: any) => attempt('doGenerate', options),
    doStream: (options: any) => attempt('doStream', options),
  };
}
