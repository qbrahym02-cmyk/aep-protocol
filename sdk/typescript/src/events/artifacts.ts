/**
 * Artifact Manager
 * Reference: spec/004-execution.md §Artifactsschemas/artifact.json
 * 
 * Data Messages. artifact with metadata .
  */

import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Artifact } from "../core/types.js";

export interface ArtifactStoreOptions {
  rootDir: string;
  defaultRetentionMs?: number;
}

export class ArtifactManager {
  private cache = new Map<string, { artifact: Artifact; data: Buffer }>();
  private opts: ArtifactStoreOptions;

  constructor(opts: ArtifactStoreOptions) {
    this.opts = opts;
  }

  /**
    * artifact .
    */
  async store(data: Buffer | string, opts: {
    mime_type: string;
    provenance?: Artifact["provenance"];
    retention?: Artifact["retention"];
    access_policy?: Artifact["access_policy"];
    encoding?: "raw" | "base64" | "url";
  }): Promise<Artifact> {
    const buf = typeof data === "string" ? Buffer.from(data) : data;
    const id = `art_${randomUUID().slice(0, 12)}`;
    const sha256 = createHash("sha256").update(buf).digest("hex");

    const artifact: Artifact = {
      id,
      mime_type: opts.mime_type,
      size: buf.length,
      checksum: { algorithm: "sha256", value: sha256 },
      encoding: opts.encoding || "raw",
      location: `file://${join(this.opts.rootDir, id)}`,
      provenance: opts.provenance,
      retention: opts.retention,
      access_policy: opts.access_policy,
    };

    // persist to disk
    await mkdir(this.opts.rootDir, { recursive: true });
    await writeFile(join(this.opts.rootDir, id), buf);

    // in-memory cache
    this.cache.set(id, { artifact, data: buf });
    return artifact;
  }

  /**
    * artifact .
    */
  async retrieve(id: string): Promise<{ artifact: Artifact; data: Buffer } | null> {
    const cached = this.cache.get(id);
    if (cached) return cached;

    // try disk
    try {
      const path = join(this.opts.rootDir, id);
      const data = await readFile(path);
      const s = await stat(path);
      const sha256 = createHash("sha256").update(data).digest("hex");
      const artifact: Artifact = {
        id,
        mime_type: "application/octet-stream",
        size: s.size,
        checksum: { algorithm: "sha256", value: sha256 },
        encoding: "raw",
        location: `file://${path}`,
      };
      this.cache.set(id, { artifact, data });
      return { artifact, data };
    } catch {
      return null;
    }
  }

  /**
    * metadata (without Data).
    */
  getMetadata(id: string): Artifact | null {
    return this.cache.get(id)?.artifact || null;
  }

  /**
    * artifact.
    */
  delete(id: string): boolean {
    return this.cache.delete(id);
  }

  /**
    * manager.
    */
  stats(): { count: number; total_size: number } {
    let total_size = 0;
    for (const { artifact } of this.cache.values()) total_size += artifact.size;
    return { count: this.cache.size, total_size };
  }
}
