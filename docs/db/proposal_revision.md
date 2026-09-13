# proposal_revision

## proposal_revision

An append-only snapshot of a proposal's content, written every time the  
speaker saves.  
  
This exists so a reviewer's comment can be read against the wording it was  
written about: proposals stay editable for life, so without it, tidying an  
abstract would silently orphan the feedback on it. History cannot be  
reconstructed after the fact, which is why it is here before the review  
screens that consume it.  
  
Status is not snapshotted — it is not content, and a comment is never about  
it.

### Columns

| Name | Type | Default | Nullable | Children | Parents | Comment |
|------|------|---------|----------|----------|---------|---------|
| **id** | text | - | NO | - | - | - |
| proposal_id | text | - | NO | - | [proposal.id](./proposal.md) | - |
| revision | integer | - | NO | - | - | 1, 2, 3 … per proposal. Allocated in SQL, never read-then-written. |
| title | text | - | NO | - | - | - |
| abstract | text | - | NO | - | - | - |
| format | text | - | NO | - | - | - |
| level | text | - | NO | - | - | - |
| topics | text | - | NO | - | - | - |
| links | text | - | NO | - | - | - |
| bio | text | - | NO | - | - | - |
| created_at | integer | `(cast(unixepoch('subsecond') * 1000 as integer))` | NO | - | - | - |

### Constraints

| Name | Type | Definition |
|------|------|------------|
| fk_proposal_id_proposal | FOREIGN KEY | (proposal_id) → proposal(id) |

### Indexes

| Name | Columns | Unique | Type |
|------|---------|--------|------|
| proposal_revision_proposalId_revision_idx | proposal_id, revision | YES | - |

### Relations

| Parent | Child | Type |
|--------|-------|------|
| [proposal.id](./proposal.md) | **[proposal_revision.proposal_id](./proposal_revision.md)** | Many to One |
