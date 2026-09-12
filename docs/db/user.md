# user

## user

### Columns

| Name | Type | Default | Nullable | Children | Parents | Comment |
|------|------|---------|----------|----------|---------|---------|
| **id** | text | - | NO | [account.user_id](./account.md), [session.user_id](./session.md) | - | - |
| name | text | - | NO | - | - | - |
| email | text | - | NO | - | - | - |
| email_verified | integer | `false` | NO | - | - | - |
| image | text | - | YES | - | - | - |
| created_at | integer | `(cast(unixepoch('subsecond') * 1000 as integer))` | NO | - | - | - |
| updated_at | integer | `(cast(unixepoch('subsecond') * 1000 as integer))` | NO | - | - | - |
| role | text | `'speaker'` | YES | - | - | - |

### Relations

| Parent | Child | Type |
|--------|-------|------|
| **[user.id](./user.md)** | [account.user_id](./account.md) | Many to One |
| **[user.id](./user.md)** | [session.user_id](./session.md) | Many to One |
