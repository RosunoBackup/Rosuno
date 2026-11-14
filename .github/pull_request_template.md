## Work item

- Work item: `P?-???` (Packet `docs/work-items/<ID>/PACKET.md`)
- What changed and why:

## Tests

Commands run on the final head and their results (CI on the exact head is the acceptance evidence):

```text
pnpm run format:check
pnpm run typecheck
pnpm run build
pnpm run p0:validate
pnpm run p0:test
pnpm run secrets:check
pnpm run dependency:check
```

- Failure tests for the changed behaviour:

## Security / integrity

<!-- Required for every PR (IMP §1; DL-ENG-2 G2). One line is enough when there is no security impact. For
authentication, authorization/RLS, migrations, payments, regulatory/eligibility, storage or physical-model work:
threats considered, tests proving the boundary, residual risks. -->

## Environment and data impact

- Migrations: `none` / list (new migrations only; historical migrations unchanged)
- Persistent environments touched: `none` (repository merge applies nothing)
- Secrets: none in this PR

## Review

- Designated human approval of the exact head is required before merge. The owner merges.
- Independent review: `not requested` / `requested — <who, result>` (optional, owner's choice).
