/**
 * Event Emitter & Subscription Manager
 * Reference: spec/004-execution.md §Eventsspec/004-execution.md §Event Delivery
 * 
 * Supports:
 * - publish / subscribe
 * - replay from sequence
 * - backpressure (pause / buffer / resume / drop / disconnect)
 * - delivery semantics: at-most-once / at-least-once / effectively-once
  */

import { randomUUID } from "node:crypto";
import type { AEPEvent } from "../core/types.js";

export type DeliverySemantics = "at_most_once" | "at_least_once" | "effectively_once";
export type BackpressureAction = "pause" | "buffer" | "resume" | "drop" | "disconnect";

export interface SubscriptionOptions {
  filter?: (event: AEPEvent) => boolean;
  delivery?: DeliverySemantics;
  buffer_size?: number;
  on_backpressure?: BackpressureAction;
}

export interface Subscription {
  id: string;
  handle: string; // subscription_handle
  callback: (event: AEPEvent) => void | Promise<void>;
  options: SubscriptionOptions;
  buffer: AEPEvent[];
  paused: boolean;
  dropped: number;
  created_at: string;
}

export class EventEmitter {
  private subscriptions = new Map<string, Subscription>();
  private events: AEPEvent[] = [];
  private sequence = 0;
  private maxBufferSize = 1000;

  /**
    * . Returns subscription handle.
    */
  subscribe(callback: (event: AEPEvent) => void | Promise<void>, options: SubscriptionOptions = {}): string {
    const id = `sub_${randomUUID().slice(0, 10)}`;
    const handle = `subh_${randomUUID().slice(0, 10)}`;
    const sub: Subscription = {
      id,
      handle,
      callback,
      options: {
        delivery: "at_least_once",
        buffer_size: 100,
        on_backpressure: "buffer",
        ...options,
      },
      buffer: [],
      paused: false,
      dropped: 0,
      created_at: new Date().toISOString(),
    };
    this.subscriptions.set(id, sub);
    return handle;
  }

  unsubscribe(handle: string): boolean {
    for (const [id, sub] of this.subscriptions) {
      if (sub.handle === handle) {
        this.subscriptions.delete(id);
        return true;
      }
    }
    return false;
  }

  pause(handle: string): boolean {
    for (const sub of this.subscriptions.values()) {
      if (sub.handle === handle) {
        sub.paused = true;
        return true;
      }
    }
    return false;
  }

  resume_(handle: string): boolean {
    for (const sub of this.subscriptions.values()) {
      if (sub.handle === handle) {
        sub.paused = false;
        // flush buffer
        for (const evt of sub.buffer) {
          this.deliver(sub, evt);
        }
        sub.buffer = [];
        return true;
      }
    }
    return false;
  }

  /**
    * . subscribers .
    */
  emit(event: AEPEvent): void {
    // assign sequence if not set
    if (event.sequence === undefined) {
      event.sequence = ++this.sequence;
    } else {
      this.sequence = Math.max(this.sequence, event.sequence);
    }

    // store for replay
    this.events.push(event);
    if (this.events.length > this.maxBufferSize) {
      this.events.shift();
    }

    // deliver to matching subscribers
    for (const sub of this.subscriptions.values()) {
      if (sub.options.filter && !sub.options.filter(event)) continue;
      this.deliver(sub, event);
    }
  }

  private deliver(sub: Subscription, event: AEPEvent): void {
    if (sub.paused) {
      if (sub.options.on_backpressure === "buffer" || sub.options.on_backpressure === undefined) {
        if (sub.buffer.length >= (sub.options.buffer_size || 100)) {
          // overflow
          if (sub.options.on_backpressure === "buffer") {
            sub.buffer.shift();
            sub.dropped++;
          }
        }
        sub.buffer.push(event);
      } else if (sub.options.on_backpressure === "drop") {
        sub.dropped++;
        return;
      } else if (sub.options.on_backpressure === "disconnect") {
        this.unsubscribe(sub.handle);
        return;
      }
      return;
    }

    try {
      const ret = sub.callback(event);
      if (ret instanceof Promise) {
        // for at-least-once, retry on rejection
        ret.catch(() => {
          if (sub.options.delivery === "at_least_once") {
            // simple retry: re-buffer
            sub.buffer.push(event);
          }
        });
      }
    } catch {
      if (sub.options.delivery === "at_least_once") {
        sub.buffer.push(event);
      }
    }
  }

  /**
    * Replay Events sequence with.
    */
  replay(fromSequence: number, filter?: (event: AEPEvent) => boolean): AEPEvent[] {
    return this.events.filter(
      (e) =>
        (e.sequence ?? 0) >= fromSequence &&
        (!filter || filter(e))
    );
  }

  /**
    * emitter (observability).
    */
  stats(): {
    subscribers: number;
    total_events: number;
    sequence: number;
    by_type: Record<string, number>;
  } {
    const by_type: Record<string, number> = {};
    for (const e of this.events) {
      by_type[e.type] = (by_type[e.type] || 0) + 1;
    }
    return {
      subscribers: this.subscriptions.size,
      total_events: this.events.length,
      sequence: this.sequence,
      by_type,
    };
  }
}
