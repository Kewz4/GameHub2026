import { sanitizeConsoleLogValue } from "@shared";

type LogMessageWithData = {
  data: unknown[];
};

/**
 * electron-log runs hooks independently for each enabled transport. Returning
 * a sanitized copy here ensures the file, console and diagnostics transports
 * all receive the same secret-free payload without mutating the caller's
 * Error/Axios object.
 */
export function sanitizeLogMessageBeforeTransport<T extends LogMessageWithData>(
  message: T
): T {
  return {
    ...message,
    data: message.data.map((value) => sanitizeConsoleLogValue(value)),
  };
}
