/**
 * Clock — Injectable time source for deterministic tests.
 * Reference: AEP_10_10 §112 Time
 * 
 * Production code MUST NOT use `new Date()` directly in business logic.
 * Instead, inject a Clock. Tests use FakeClock for reproducibility.
  */

export interface Clock {
  now(): Date;
  nowIso(): string;
  nowEpochMs(): number;
}

export class SystemClock implements Clock {
  now(): Date { return new Date(); }
  nowIso(): string { return new Date().toISOString(); }
  nowEpochMs(): number { return Date.now(); }
}

export class FakeClock implements Clock {
  private _time: number;

  constructor(initialTime: number = Date.now()) {
    this._time = initialTime;
  }

  now(): Date { return new Date(this._time); }
  nowIso(): string { return new Date(this._time).toISOString(); }
  nowEpochMs(): number { return this._time; }

  advance(ms: number): void { this._time += ms; }
  advanceSeconds(s: number): void { this._time += s * 1000; }
  advanceMinutes(m: number): void { this._time += m * 60 * 1000; }
  advanceHours(h: number): void { this._time += h * 60 * 60 * 1000; }
  setTime(time: number): void { this._time = time; }
  setTimeIso(iso: string): void { this._time = new Date(iso).getTime(); }
}
