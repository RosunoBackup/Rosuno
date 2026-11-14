# ROSUNO DECISION LOG ENTRY DL-ENG-2 — GOVERNANCE SIMPLIFICATION

| Field            | Value                                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------- |
| Decision         | DL-ENG-2, registered in `governance/decision-log.json`                                               |
| Title            | Optional independent review, single-authorization engineering and lightweight closure                |
| Category         | Process (Implementation Master Plan §6)                                                              |
| Owner / approver | NatthanPrevot                                                                                        |
| Operative        | From the owner's express adoption, which this file's registration on owner `main` records            |
| Amends           | DL-ENG-1 R4 (first sentence only) and R3 (post-merge correction); every other DL-ENG-1 ruling stands |

## Authority basis

The LOCKED authorities route process changes to the project Decision Log: Implementation Master Plan §47, MVP Build
Specification §§30 and 32, and Physical Specification §53. This entry changes no locked text and no product,
domain, physical-model, policy, counsel- or regulator-gated matter. Citations are by document and section only.

## Rulings

**G1 — Independent review is optional (amends DL-ENG-1 R4, first sentence).**

- Independent review by ChatGPT, the "Independent Backup" or anyone else is optional, at the owner's discretion.
- It is never a prerequisite for:
  - work-item authorization or Packet adoption;
  - implementation, publication, PRs or merge;
  - database work or deployment;
  - closure.
- The locked authorities recommend AI review (IMP §§4, 33) and permit Claude to perform code review (MB §168). None
  requires an independent or second reviewer.
- The rest of R4 stands:
  - designated human approval before merge (IMP §§9, 45, 46) remains mandatory for every change;
  - passing CI alone is never sufficient;
  - AI review is never legal verification (RMS §39).

**G2 — Security/integrity review step (IMP §1).** For every slice, the security/integrity review step consists of
three parts:

- required CI and the trusted guard on the exact head;
- the "Security / integrity" section Claude writes in the PR, detailed for authentication, authorization/RLS,
  migration, payment, regulatory or eligibility, storage and physical-model work, and one line otherwise;
- the designated human approval, which is the review decision.

A production security review (IMP §40) remains required before production.

**G3 — One authorization per bounded task; in-scope correction after merge (amends DL-ENG-1 R3).**

- One owner-adopted Packet and grant cover implementation, testing, debugging, refactoring, correction and
  revalidation (unchanged).
- After merge, a defect inside that Packet's scope may be corrected under the same Packet when the owner says so. The
  corrections are recorded in commits and the PR (IMP §6), with no new Packet.
- A correction outside the scope uses a FIX Packet in the R5 short form.
- The coding agent still cannot turn a proposal into a new truth by committing it: merge remains the owner's act after
  designated human review (IMP §6).

**G4 — Lightweight, truthful closure (IMP §§2.5, 7, 8).** A work item is closed when two things hold:

- its PR is merged with green CI, including its failure tests (IMP §2.5), and designated approval;
- any migration it carries is applied to the intended persistent environment, or the owner records a decision not to
  apply it yet.

Registry facts are recorded in the same PR when known, otherwise in the next PR in the area or a batched records PR.
No dedicated closure work item. Release records keep work-item IDs, commits and the migration set (IMP §8). An absent
optional review never holds closure open. Records name only events that occurred, with their real times. No record
claims compliance with a requirement that was not demonstrated.

**G5 — Tools and connectors.**

- The owner decides which tools, connectors and MCP servers are available. The repository contains no blanket ban or
  allowlist that prevents an owner-enabled tool from loading.
- Authorization is separate: read-only use within the task is authorized; writes and persistent effects need the
  owner's word.
- Locked limits apply to every tool:
  - environments and credentials stay separated (IMP §8; TA §42);
  - deployed databases change only through reviewed migrations, with no manual or connector-driven schema edits
    (IMP §35);
  - no synthetic business data persists outside disposable or rollback-only validation (PSS §45; FP-1 §3.4);
  - no AI resolves a gated item (DM §0; PM §0).

**G6 — Transition.** Nothing completed under UOM v1.7.10 is reinterpreted. A v1.7.10 requirement that this entry
removes, and that was not satisfied, is recorded as not performed. It is never recorded as met.
