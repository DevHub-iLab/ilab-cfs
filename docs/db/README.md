# Tables

| Name | Columns | Comment |
|------|---------|---------|
| [account](./account.md) | 13 |  |
| [cfp](./cfp.md) | 8 | A call for speakers.  `closes_at IS NULL` is a continuously running call; a date makes it an event-specific call that stops taking submissions at that moment. Both kinds are live at the same time, so nothing may assume a single current call.  There is no `status` column: closing a call *is* setting `closes_at`, and "open" is `closes_at IS NULL OR closes_at > now` — the same predicate the submission guard already has to run in SQL. A second source of truth for open-ness could only disagree with it.  Deleting is soft, and `deleted_at` is the one place that is not true of: it is a second thing a query has to ask, because a deleted call is neither open nor closed but gone from everywhere except the admin's own list, where it can be restored.  Timestamp and id conventions follow Better Auth's generated tables rather than picking our own, so one migration stream stays internally consistent. |
| [proposal](./proposal.md) | 14 | A pitch, belonging to a speaker and to the call it was pitched to.  The content columns are `notNull` with empty defaults rather than nullable: a draft is allowed to be half-written — the design's own example is "Untitled — something about WebGPU" — so emptiness is a normal state, not a missing value. Completeness is asserted when the status becomes `submitted`, which is the moment it starts to matter.  `topics` and `links` are JSON arrays rather than two more tables. Nothing queries across them yet — no screen filters by topic — and a field beats a table until something needs the join.  No `event_id` column yet: `event` does not exist, and a nullable column is a cheap `ALTER TABLE` once it does. |
| [proposal_revision](./proposal_revision.md) | 11 | An append-only snapshot of a proposal's content, written every time the speaker saves.  This exists so a reviewer's comment can be read against the wording it was written about: proposals stay editable for life, so without it, tidying an abstract would silently orphan the feedback on it. History cannot be reconstructed after the fact, which is why it is here before the review screens that consume it.  Status is not snapshotted — it is not content, and a comment is never about it. |
| [rate_limit](./rate_limit.md) | 4 |  |
| [session](./session.md) | 8 |  |
| [user](./user.md) | 8 |  |
| [verification](./verification.md) | 6 |  |

---

## ER Diagram

```mermaid
erDiagram
    account }o--|| user : "user_id"
    proposal }o--|| cfp : "cfp_id"
    proposal }o--|| user : "speaker_id"
    proposal_revision }o--|| proposal : "proposal_id"
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
        int deleted_at "Deleted calls are hidden, not removed. Null is a live call.  Unlike `closes_at`, which is a fact about the call the whole product reads, this one is bookkeeping: every query outside the admin's own list has to exclude it, which is why the predicate both the homepage and the submission guard run lives in one place — `takingSubmissions()` in `src/lib/calls.ts` — rather than being written out per page."
        int created_at
        int updated_at
    }
    proposal {
        text id PK
        text cfp_id FK
        text speaker_id FK "A speaker's proposals go with them: nothing here outlives the account"
        text status
        text title
        text abstract
        text format
        text level
        text topics
        text links
        text bio
        int submitted_at "First crossing into `submitted`. Null while it has never left draft."
        int created_at
        int updated_at
    }
    proposal_revision {
        text id PK
        text proposal_id FK
        int revision "1, 2, 3 … per proposal. Allocated in SQL, never read-then-written."
        text title
        text abstract
        text format
        text level
        text topics
        text links
        text bio
        int created_at
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
