# HackRef demo recording guide

Target: **approximately 2:40**, including title/closing frames. Record the running browser application, then the already-verified sandbox receipt. No new registrations, evaluations, finalizations, awards, sends, or reconciliation calls are needed for this recording.

## Prepare the existing showcase

Use **HackRef Evaluation Pilot**, not the local seed. The [existing readiness snapshot](FINAL_READINESS_PASS.md) identifies four non-demo projects finalized against **Combined Rubric v5**, maximum 40:

| Project | Human final | Percentage |
| --- | --- | --- |
| Airline Booking CLI | 31/40 | 77.5% |
| FundFlow | 33/40 | 82.5% |
| HackRef | 31/40 | 77.5% |
| Project Idea Vault | 33/40 | 82.5% |

These are existing human judgments, not benchmarks or seed scores. Verify the visible event/records before recording; do not alter data to match a script. The readiness snapshot distinguishes the development and showcase databases. **A fresh installation contains neither these four projects/finals nor the previously verified PayPal payout record.** No private database export is included. This recording uses the maintainer's existing records; dedicated judge access to private provider accounts remains unarranged, as detailed in [judge-access status](JUDGE_SETUP.md#judge-access-requirements-and-status).

Open `/submissions`, an existing evidence/review page, `/judging`, `/analytics`, and the existing USD 0.10 sandbox award/payout record. Sign in off-camera. In Analytics select **Clear all filters**: full scope should show **4 projects** and highest human-finalized percentage **82.5%**. Do not describe sorting or the two ties as an automatically selected winner.

Prepare a redacted capture of the **separately verified integrated USD 0.10 PayPal sandbox payout** and its recipient-account receipt. Use actual existing evidence; do not imply this payment awarded the showcase winner or was sent during recording. Keep amount, currency, sandbox context, and individual-item success readable. Mask full emails, credentials, balances, account names/identifiers, transaction IDs, unrelated activity, and browser profile details. Private award details can expose the full address even if send controls mask it: crop/redact the entire sensitive area. Do not open `.env`, provider credentials, raw logs, or network payloads.

## Script and shot list

| Time | Picture / action | Spoken script |
| --- | --- | --- |
| 0:00–0:15 | Brief title, then live Submissions registry with all four project names. | “Hackathon organizers need to compare projects, explain scores, and track prizes. HackRef connects AI-assisted review, human decisions, and explicitly approved PayPal sandbox awards.” |
| 0:15–0:35 | Existing repository snapshot: pinned SHA, claims, rubric/run. Optionally show registration without submitting. | “Every public GitHub submission is pinned to a fixed commit and a versioned rubric. A worker collects selected source excerpts. HackRef never runs submitted code or tests.” |
| 0:35–0:58 | Completed Gemini review: model, one line citation, uncertainty, coverage limits. Open a prepared citation. | “Gemini 3.5 Flash Lite suggests scores with citations and uncertainty. Its findings remain unverified. Unsupported criteria stay unscored. These excerpts help a judge review the project; they do not prove that it works.” |
| 0:58–1:18 | Existing human-finalized review, preserved draft, criterion decisions and reasoning. | “A human reviews each criterion, accepts a suggestion or supplies a score with reasons, then confirms the final assessment. That decision is immutable, and the AI draft is preserved. Finalizing scores never sends money.” |
| 1:18–1:38 | `/judging`: AG Grid search/sort, rubric and AI/human columns. Keep four-project scope clear. | “AG Grid compares these four projects against the same rubric. Teal shows human finals; amber shows AI suggestions. Missing scores stay blank, and equal scores remain ties.” |
| 1:38–2:00 | `/analytics`: Review Progress, then leaderboard or criteria. Select a row, show scope notice, then Clear all filters. | “AG Studio shows progress and score comparisons. This showcase has four projects, with a highest final score of 82.5 percent. Selections filter the report; clear filters restores it. Evidence coverage counts citations, not working features.” |
| 2:00–2:28 | Redacted existing approval/payout status and recipient receipt. Overlay: “Previously verified · separate USD 0.10 SANDBOX test.” Do not click Send/Reconcile. | “Separately, this previously verified ten-cent sandbox payout shows the payment workflow. An award requires approval of exact terms, then a separate send authorization. The matching individual PayPal item succeeded, and receipt was checked in the recipient sandbox account. Batch acceptance alone is not payment confirmation. No real money moved.” |
| 2:28–2:40 | README/setup links, then app/title closing frame. | “The MIT-licensed source includes local setup. Fresh installs start without these showcase or payout records. HackRef supports static review and sandbox payouts only.” |

All four showcase assessments are already finalized. Show persisted decisions; do not pretend to finalize them again. If provenance/results differ from a prepared shot, show actual records rather than changing them. A cut from an existing completed job to its draft is fine; do not describe it as a new live evaluation.

## Recording and handoff

Use readable desktop resolution and clear English narration. Zoom into evidence and approval states; hide notifications, bookmarks, and unrelated tabs. Avoid setup terminals and provider loading waits. Review redactions frame by frame, including transitions and tooltips. Use original/authorized assets and no unlicensed music.

Export below **3:00**, targeting **approximately 2:40**. Upload a **publicly visible YouTube** video, verify it signed out, then replace **[TODO: paste final public YouTube URL]** in README and Devpost materials. Use absolute GitHub URLs for the final published source revision and [judge setup](JUDGE_SETUP.md) when copying into Devpost. The [official requirements](https://paypalaihackathon.devpost.com/) specify a functioning demo video under three minutes and public YouTube visibility.
