type LogMeta = Record<string, unknown>;

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value, (_key, item) => {
      if (item instanceof Error) {
        return {
          name: item.name,
          message: item.message,
          stack: item.stack,
          code: (item as { code?: string }).code,
          statusCode: (item as { statusCode?: number }).statusCode
        };
      }

      if (typeof item === "string" && item.length > 500) {
        return `${item.slice(0, 500)}…`;
      }

      return item;
    });
  } catch {
    return "[unserializable]";
  }
}

export function truncateForLog(value: string | null | undefined, maxLength = 120) {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!normalized) {
    return "";
  }

  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized;
}

export function summarizeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }

  return {
    message: typeof error === "string" ? error : safeJson(error)
  };
}

function formatMeta(meta?: LogMeta) {
  if (!meta || Object.keys(meta).length === 0) {
    return "";
  }

  return ` ${safeJson(meta)}`;
}

export function logInfo(scope: string, message: string, meta?: LogMeta) {
  console.info(`[${scope}] ${message}${formatMeta(meta)}`);
}

export function logWarn(scope: string, message: string, meta?: LogMeta) {
  console.warn(`[${scope}] ${message}${formatMeta(meta)}`);
}

export function logError(scope: string, message: string, meta?: LogMeta) {
  console.error(`[${scope}] ${message}${formatMeta(meta)}`);
}
