# proposal

## proposal

A pitch, belonging to a speaker and to the call it was pitched to.  
  
The content columns are `notNull` with empty defaults rather than nullable:  
a draft is allowed to be half-written — the design's own example is  
"Untitled — something about WebGPU" — so emptiness is a normal state, not a  
missing value. Completeness is asserted when the status becomes `submitted`,  
which is the moment it starts to matter.  
  
`topics` and `links` are JSON arrays rather than two more tables. Nothing  
queries across them yet — no screen filters by topic — and a field beats a  
table until something needs the join.  
  
No `event_id` column yet: `event` does not exist, and a nullable column is  
a cheap `ALTER TABLE` once it does.

### Columns

| Name | Type | Default | Nullable | Children | Parents | Comment |
|------|------|---------|----------|----------|---------|---------|
| **id** | text | - | NO | [proposal_revision.proposal_id](./proposal_revision.md) | - | - |
| cfp_id | text | - | NO | - | [cfp.id](./cfp.md) | - |
| speaker_id | text | - | NO | - | [user.id](./user.md) | A speaker's proposals go with them: nothing here outlives the account |
| status | text | `'draft'` | NO | - | - | - |
| title | text | `''` | NO | - | - | - |
| abstract | text | `''` | NO | - | - | - |
| format | text | `'talk'` | NO | - | - | - |
| level | text | `'intermediate'` | NO | - | - | - |
| topics | text | `[]` | NO | - | - | - |
| links | text | `[]` | NO | - | - | - |
| bio | text | `''` | NO | - | - | - |
| submitted_at | integer | - | YES | - | - | First crossing into `submitted`. Null while it has never left draft. |
| created_at | integer | `(cast(unixepoch('subsecond') * 1000 as integer))` | NO | - | - | - |
| updated_at | integer | `(cast(unixepoch('subsecond') * 1000 as integer))` | NO | - | - | - |

### Constraints

| Name | Type | Definition |
|------|------|------------|
| fk_cfp_id_cfp | FOREIGN KEY | (cfp_id) → cfp(id) |
| fk_speaker_id_user | FOREIGN KEY | (speaker_id) → user(id) |

### Indexes

| Name | Columns | Unique | Type |
|------|---------|--------|------|
| proposal_speakerId_idx | speaker_id | NO | - |
| proposal_cfpId_status_idx | cfp_id, status | NO | - |

### Relations

| Parent | Child | Type |
|--------|-------|------|
| [cfp.id](./cfp.md) | **[proposal.cfp_id](./proposal.md)** | Many to One |
| [user.id](./user.md) | **[proposal.speaker_id](./proposal.md)** | Many to One |
| **[proposal.id](./proposal.md)** | [proposal_revision.proposal_id](./proposal_revision.md) | Many to One |
