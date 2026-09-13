# cfp

## cfp

A call for speakers.  
  
`closes_at IS NULL` is a continuously running call; a date makes it an  
event-specific call that stops taking submissions at that moment. Both kinds  
are live at the same time, so nothing may assume a single current call.  
  
There is no `status` column: closing a call *is* setting `closes_at`, and  
"open" is `closes_at IS NULL OR closes_at > now` — the same predicate the  
submission guard already has to run in SQL. A second source of truth for  
open-ness could only disagree with it.  
  
Timestamp and id conventions follow Better Auth's generated tables rather  
than picking our own, so one migration stream stays internally consistent.

### Columns

| Name | Type | Default | Nullable | Children | Parents | Comment |
|------|------|---------|----------|----------|---------|---------|
| **id** | text | - | NO | [proposal.cfp_id](./proposal.md) | - | - |
| name | text | - | NO | - | - | - |
| track | text | - | NO | - | - | - |
| description | text | - | YES | - | - | The blurb under the name on the landing page. |
| closes_at | integer | - | YES | - | - | - |
| created_at | integer | `(cast(unixepoch('subsecond') * 1000 as integer))` | NO | - | - | - |
| updated_at | integer | `(cast(unixepoch('subsecond') * 1000 as integer))` | NO | - | - | - |

### Indexes

| Name | Columns | Unique | Type |
|------|---------|--------|------|
| cfp_closesAt_idx | closes_at | NO | - |

### Relations

| Parent | Child | Type |
|--------|-------|------|
| **[cfp.id](./cfp.md)** | [proposal.cfp_id](./proposal.md) | Many to One |
