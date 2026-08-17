# AEP 007 — Handles

**Status:** AEP Core 0.1 — NORMATIVE  
**Keywords:** RFC 2119.

## 1. Overview

handles   opaque  .  handle  string    .

## 2. Handle Types

| Type | Pattern | مثال |
|---|---|---|
| `execution_handle` | `exec_` + 12+ random chars | `exec_a1b2c3d4e5f6` |
| `resource_handle` | `res_` + 12+ random chars | `res_db_customers` |
| `cursor_handle` | `cur_` + 12+ random chars | `cur_abc123xyz` |
| `transaction_handle` | `tx_` + 12+ random chars | `tx_xyz789` |
| `subscription_handle` | `sub_` + 12+ random chars | `sub_pqr456` |
| `artifact_handle` | `art_` + 12+ random chars | `art_99` |
| `delegation_handle` | `del_` + 12+ random chars | `del_07` |
| `approval_handle` | `ap_` + 12+ random chars | `ap_01` |
| `checkpoint_handle` | `ckp_` + 12+ random chars | `ckp_42` |

## 3. Properties

 handle MUST:

1. **Opaque** —   state  ( SQL  file paths  user IDs).
2. **Unique** —   collisions    handle.
3. **Random** —    (entropy ≥ 96 bits).
4. **Scoped** —  principal + tenant.
5. **Expirable** —  `expires_at` ( ).

## 4. Zero Trust

 handle   authorization.  request  handle MUST  authorization .

```text
client: "execute step 2 of tx_xyz"
server: → verify tx_xyz still active
         → verify principal still authorized
         → verify budget still available
         → execute
```

## 5. Cursor Security

cursor handle MUST  :

- SQL queries
- table names
- index hints
- pagination offsets (داخلية)
- user IDs


```text
cur_a1b2c3d4e5f6
```


```text
SELECT * FROM users WHERE id > 100 LIMIT 50  --   
```

## 6. Lifecycle

| Handle | Default TTL | Max TTL |
|---|---|---|
| `execution_handle` | 24h | 7d |
| `resource_handle` | session | session |
| `cursor_handle` | 5m | 1h |
| `transaction_handle` | 60s | 5m |
| `subscription_handle` | 1h | 24h |
| `artifact_handle` | 24h | configurable |
| `approval_handle` | 30m | 2h |
| `checkpoint_handle` | 7d | 30d |

server SHOULD  handles  .
client SHOULD  `HANDLE_EXPIRED` error   handle.

## 7. Handle Revocation

server MAY  revoke handles :

```http
POST /aep/handles/{handle}/revoke
```

revocation MUST      .
revocation MUST       handle.

## 8. Cross-Server Handles

 distributed deployment handles MAY :

- **server-local** — يعمل فقط على الـserver الذي أصدره.
- **cluster-scoped** — يعمل على أي server ضمن cluster (requires shared state).
- **portable** — يحمل توقيعًا يمكن التحقق منه بدون state مشترك (مرجع `profiles/authority.md §Portable Authority`).

0.1 handles  server-local .
