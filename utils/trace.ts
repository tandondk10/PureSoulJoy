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

export const traceStart = (traceId: string, name: string, traceLevel: number): number => {
  if (traceLevel >= 4) {
    console.log(`[${nowISO()}][FE][FUNC][${traceId}] → ${name}`);
  }
  return Date.now();
};

export const traceEnd = (traceId: string, name: string, start: number, traceLevel: number): void => {
  if (traceLevel >= 4) {
    console.log(`[${nowISO()}][FE][FUNC][${traceId}] ← ${name} ${Date.now() - start}ms`);
  }
};