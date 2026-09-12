# verification

## verification

### Columns

| Name | Type | Default | Nullable | Children | Parents | Comment |
|------|------|---------|----------|----------|---------|---------|
| **id** | text | - | NO | - | - | - |
| identifier | text | - | NO | - | - | - |
| value | text | - | NO | - | - | - |
| expires_at | integer | - | NO | - | - | - |
| created_at | integer | `(cast(unixepoch('subsecond') * 1000 as integer))` | NO | - | - | - |
| updated_at | integer | `(cast(unixepoch('subsecond') * 1000 as integer))` | NO | - | - | - |

### Indexes

| Name | Columns | Unique | Type |
|------|---------|--------|------|
| verification_identifier_idx | identifier | NO | - |
