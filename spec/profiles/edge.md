# AEP Profile — Edge & Offline

**Status:** AEP Profile 0.1 — NORMATIVE  
**Keywords:** RFC 2119.

## 1. Motivation

edge devices (IoT, mobile, intermittent connectivity):

- CBOR encoding (smaller payloads)
- Offline-first
- Sync when connected
- Small payloads
- Battery-efficient

## 2. CBOR Encoding

```text
application/aep+cbor
```

server MAY  CBOR  JSON.

CBOR advantages:
- ~30% smaller payloads
- Binary efficiency
- Native support for binary data

## 3. Offline-First

```text
Device offline → queue requests locally → sync when connected
```

```json
{
  "aep": "0.1",
  "id": "req_local_01",
  "type": "execute",
  "input": { ... },
  "execution": {
    "mode": "async",
    "offline_queue": true,
    "sync_when_connected": true
  }
}
```

## 4. Sync Protocol

```http
POST /aep/sync
{
  "queued_requests": [
    { "id": "req_local_01", "envelope": {...} },
    { "id": "req_local_02", "envelope": {...} }
  ]
}
```


```json
{
  "results": [
    { "id": "req_local_01", "status": "completed", "output": {...} },
    { "id": "req_local_02", "status": "error", "error": {...} }
  ]
}
```

## 5. Conflict Resolution

sync   conflicts:
- نفس resource عُدّل offline وonline
- نفس idempotency_key استُخدم

server SHOULD :
- last-write-wins (default)
- merge (إذا ممكن)
- manual conflict (رجع للـuser)

## 6. Payload Compression

server MAY :
- gzip
- brotli
- zstd

 `Content-Encoding` header.

## 7. Battery Efficiency

- Avoid polling
- Use SSE / WebSocket للـevents
- Long-lived connections
- Minimize handshake overhead

## 8. Network Constraints

```json
{
  "execution": {
    "max_payload_kb": 64,
    "timeout_ms": 30000,
    "retry_on_network_failure": true
  }
}
```
