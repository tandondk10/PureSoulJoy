export const createTraceId = () => {
  return `TRACE_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
};

export const logTrace = (traceId: string, step: string, data?: any) => {
  if (data) {
    console.log(`[${traceId}] ${step}`, data);
  } else {
    console.log(`[${traceId}] ${step}`);
  }
};