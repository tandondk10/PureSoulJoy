export const createTraceId = () => {
  return `TRACE_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
};

export const nowISO = () => new Date().toISOString();

export const logTrace = (traceId: string, step: string, data?: any) => {
  if (data) {
    console.log(`[${nowISO()}][${traceId}] ${step}`, data);
  } else {
    console.log(`[${nowISO()}][${traceId}] ${step}`);
  }
};