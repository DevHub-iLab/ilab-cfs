# session

## session

### Columns

| Name | Type | Default | Nullable | Children | Parents | Comment |
|------|------|---------|----------|----------|---------|---------|
| **id** | text | - | NO | - | - | - |
| expires_at | integer | - | NO | - | - | - |
| token | text | - | NO | - | - | - |
| created_at | integer | `(cast(unixepoch('subsecond') * 1000 as integer))` | NO | - | - | - |
| updated_at | integer | - | NO | - | - | - |
| ip_address | text | - | YES | - | - | - |
| user_agent | text | - | YES | - | - | - |
| user_id | text | - | NO | - | [user.id](./user.md) | - |

### Constraints

| Name | Type | Definition |
|------|------|------------|
| fk_user_id_user | FOREIGN KEY | (user_id) → user(id) |

### Indexes

| Name | Columns | Unique | Type |
|------|---------|--------|------|
| session_userId_idx | user_id | NO | - |

### Relations

| Parent | Child | Type |
|--------|-------|------|
| [user.id](./user.md) | **[session.user_id](./session.md)** | Many to One |
