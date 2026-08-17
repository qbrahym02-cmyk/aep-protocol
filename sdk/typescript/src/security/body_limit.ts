/**
 * Body Size Limiter
 * Reference: AEP_CODE_FIRST_AUDIT.md P1-17
 * 
 * Enforces hard limits on request body size to prevent memory exhaustion.
 * 
 * Default: 1 MiB (matches AEP envelope spec)
 * Max: configurable per-route
  */

export interface BodyLimitConfig {
  /** Default max bytes for request body. */
  default_max_bytes: number;
  /** Per-route overrides. */
  per_route?: Record<string, number>;
  /** Max number of fields in JSON. */
  max_json_fields?: number;
  /** Max depth of nested objects. */
  max_json_depth?: number;
}

export const DEFAULT_BODY_LIMIT: BodyLimitConfig = {
  default_max_bytes: 1024 * 1024, // 1 MiB
  max_json_fields: 1000,
  max_json_depth: 32,
};

export class BodyLimitError extends Error {
  constructor(public code: "BODY_TOO_LARGE" | "JSON_TOO_DEEP" | "JSON_TOO_MANY_FIELDS", message: string) {
    super(message);
    this.name = "BodyLimitError";
  }
}

export class BodyLimiter {
  private config: BodyLimitConfig;

  constructor(config: BodyLimitConfig = DEFAULT_BODY_LIMIT) {
    this.config = config;
  }

  /**
    * Check Content-Length header.
    * Returns null if OK, otherwise returns the limit.
    */
  checkContentLength(contentLength: string | undefined, route?: string): number | null {
    if (!contentLength) return null;
    const len = parseInt(contentLength, 10);
    if (isNaN(len)) return null;
    const limit = this.getLimitForRoute(route);
    if (len > limit) {
      return limit;
    }
    return null;
  }

  /**
    * Stream-aware body reader that enforces byte limit.
    * Throws BodyLimitError if exceeded.
    */
  async readBody(
    stream: { [Symbol.asyncIterator](): AsyncIterableIterator<Buffer> },
    route?: string
  ): Promise<string> {
    const limit = this.getLimitForRoute(route);
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    for await (const chunk of stream) {
      totalBytes += chunk.length;
      if (totalBytes > limit) {
        throw new BodyLimitError("BODY_TOO_LARGE", `Body size ${totalBytes} exceeds limit ${limit}`);
      }
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString("utf-8");
  }

  /**
    * Validate JSON structure depth and field count.
    */
  validateJson(value: unknown): void {
    const maxDepth = this.config.max_json_depth || 32;
    const maxFields = this.config.max_json_fields || 1000;
    let fieldCount = 0;
    this.checkDepth(value, 0, maxDepth, () => {
      fieldCount++;
      if (fieldCount > maxFields) {
        throw new BodyLimitError("JSON_TOO_MANY_FIELDS", `JSON has more than ${maxFields} fields`);
      }
    });
  }

  private checkDepth(value: unknown, depth: number, maxDepth: number, onField: () => void): void {
    if (depth > maxDepth) {
      throw new BodyLimitError("JSON_TOO_DEEP", `JSON depth exceeds ${maxDepth}`);
    }
    if (Array.isArray(value)) {
      for (const item of value) this.checkDepth(item, depth + 1, maxDepth, onField);
    } else if (value && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      for (const k of Object.keys(obj)) {
        onField();
        this.checkDepth(obj[k], depth + 1, maxDepth, onField);
      }
    }
  }

  private getLimitForRoute(route?: string): number {
    if (route && this.config.per_route?.[route]) {
      return this.config.per_route[route];
    }
    return this.config.default_max_bytes;
  }
}
