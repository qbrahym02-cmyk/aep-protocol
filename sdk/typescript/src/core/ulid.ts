/**
 * ULID — Universally Unique Lexicographically Sortable Identifier
 * Reference: spec/10-10 §90 ULID Execution IDs
 * 
 * 128-bit26 Crockford Base32.
 * execution IDs becausesort storage.
 * 
 * Format:  01ARZ3NDEKTSV4RRFFQ69G5FAV
 * └─ time ─┘└──── random ────┘
  */

// Encoding table (Crockford Base32)
const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TIME_LEN = 10;
const RANDOM_LEN = 16;

/**
 * ULID with optional timestamp.
  */
export function ulid(timestamp: number = Date.now()): string {
  const time = Math.floor(timestamp);
  const timeChars = new Array<string>(TIME_LEN);
  let t = time;
  for (let i = TIME_LEN - 1; i >= 0; i--) {
    timeChars[i] = ENCODING[t % 32];
    t = Math.floor(t / 32);
  }

  const randomChars = new Array<string>(RANDOM_LEN);
  const randomness = new Uint8Array(RANDOM_LEN);
  // use crypto.getRandomValues if available
  const g = globalThis as unknown as { crypto?: { getRandomValues: (a: Uint8Array) => Uint8Array } };
  if (g.crypto?.getRandomValues) {
    g.crypto.getRandomValues(randomness);
  } else {
    // fallback to Math.random (less secure)
    for (let i = 0; i < RANDOM_LEN; i++) {
      randomness[i] = Math.floor(Math.random() * 256);
    }
  }
  for (let i = 0; i < RANDOM_LEN; i++) {
    randomChars[i] = ENCODING[randomness[i] % 32];
  }

  return timeChars.join("") + randomChars.join("");
}

/**
 * execution_id ULID.
  */
export function executionId(): string {
  return `exec_${ulid()}`;
}

/**
 * request_id ULID.
  */
export function requestId(): string {
  return `req_${ulid()}`;
}

/**
 * authority_id ULID.
  */
export function authorityId(): string {
  return `auth_${ulid()}`;
}

/**
 * artifact_id ULID.
  */
export function artifactId(): string {
  return `art_${ulid()}`;
}

/**
 * approval_id ULID.
  */
export function approvalId(): string {
  return `ap_${ulid()}`;
}

/**
 * subscription_id ULID.
  */
export function subscriptionId(): string {
  return `sub_${ulid()}`;
}

/**
 * timestamp ULID (millis since epoch).
  */
export function ulidTimestamp(ulid: string): number {
  if (ulid.startsWith("exec_") || ulid.startsWith("req_") || ulid.startsWith("auth_") ||
      ulid.startsWith("art_") || ulid.startsWith("ap_") || ulid.startsWith("sub_")) {
    ulid = ulid.split("_")[1];
  }
  if (ulid.length < TIME_LEN) return 0;
  const timePart = ulid.slice(0, TIME_LEN);
  let t = 0;
  for (let i = 0; i < TIME_LEN; i++) {
    const ch = timePart[i];
    const idx = ENCODING.indexOf(ch);
    if (idx < 0) return 0;
    t = t * 32 + idx;
  }
  return t;
}

/**
 * ULIDs .
  */
export function ulidCompare(a: string, b: string): number {
  // strip prefix
  const strip = (s: string) => s.includes("_") ? s.split("_")[1] : s;
  return strip(a).localeCompare(strip(b));
}
