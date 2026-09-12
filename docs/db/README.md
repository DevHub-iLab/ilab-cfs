# Tables

| Name | Columns | Comment |
|------|---------|---------|
| [account](./account.md) | 13 |  |
| [cfp](./cfp.md) | 7 | A call for speakers.  `closes_at IS NULL` is a continuously running call; a date makes it an event-specific call that stops taking submissions at that moment. Both kinds are live at the same time, so nothing may assume a single current call.  There is no `status` column: closing a call *is* setting `closes_at`, and "open" is `closes_at IS NULL OR closes_at > now` — the same predicate the submission guard already has to run in SQL. A second source of truth for open-ness could only disagree with it.  Timestamp and id conventions follow Better Auth's generated tables rather than picking our own, so one migration stream stays internally consistent. |
| [rate_limit](./rate_limit.md) | 4 |  |
| [session](./session.md) | 8 |  |
| [user](./user.md) | 8 |  |
| [verification](./verification.md) | 6 |  |

---

## ER Diagram

```mermaid
erDiagram
    account }o--|| user : "user_id"
    session }o--|| user : "user_id"

    account {
        text id PK
        text account_id
        text provider_id
        text user_id FK
        text access_token
        text refresh_token
        text id_token
        int access_token_expires_at
        int refresh_token_expires_at
        text scope
        text password
        int created_at
        int updated_at
    }
    cfp {
        text id PK
        text name
        text track
        text description "The blurb under the name on the landing page."
        int closes_at
        int created_at
        int updated_at
    }
    rate_limit {
        text id PK
        text key UK
        int count
        int last_request
    }
    session {
        text id PK
        int expires_at
        text token UK
        int created_at
        int updated_at
        text ip_address
        text user_agent
        text user_id FK
    }
    user {
        text id PK
        text name
        text email UK
        int email_verified
        text image
        int created_at
        int updated_at
        text role
    }
    verification {
        text id PK
        text identifier
        text value
        int expires_at
        int created_at
        int updated_at
    }
```
