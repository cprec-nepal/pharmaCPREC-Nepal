# NPC MCQs — Import Guide

**Source:** *Nepal Pharmacy Council License Exam Question Collection* by Nabin Bist (PDF, 16 pages, 100 MCQs with explanations).

**Files in this repo (GitHub = source of truth):**
- `mcqs-npc.json` — 100 MCQs in app format (`subject`, `college`, `qnumber`, `question`, `options[4]`, `answer`, `explanation`, `correctText`)
- `mcqs-npc.csv` — same 100 MCQs in Google Sheets `MCQs` format (16 columns, matches `Code.gs`)

**Mapping:** Subject = `Pharmacy`, College/Set = `NPC`, QNumber = 1–100. In the app they appear under **Faculty: Pharmacy, Set: NPC**.

## Can we add these directly from GitHub? Yes.

The data lives in this GitHub repo. To load into the live system:

### Option A — Paste into Google Sheets (fastest, bulk)
1. Open the `MCQs` sheet in the backend spreadsheet (`SS_ID` in `Code.gs`).
2. Open `mcqs-npc.csv` from GitHub (raw view) → Select All → Copy.
3. Paste into the `MCQs` sheet starting at row 2 (below headers), columns A–P.
4. Verify: open the app → Dashboard → Faculty: Pharmacy, Set: NPC → Start Quiz.

### Option B — Admin UI (one-by-one, no bulk yet)
Use Admin → Add MCQ for individual questions. (Bulk import endpoint is a future enhancement.)

## Answer key note
The PDF contains explanations but **no explicit answer key**. Correct options (A/B/C/D) were **inferred from the explanations** (and standard pharmacology where no explanation was given). Answer distribution: A=29, B=28, C=22, D=21.

⚠️ **Please verify the key before publishing** — especially Q4, Q10, Q12, Q29, Q42, Q43, Q46, Q47, Q51, Q53–55, Q57, Q62, Q70, Q76, Q85, Q87, Q88–95, Q97 (no explanation in PDF, inferred from subject knowledge). Each MCQ retains its `explanation` in JSON/CSV so you can cross-check quickly.

## Rebuild / update
To regenerate from a new PDF, re-run the parser (split by numbered questions, extract A–D options + Explanation) and re-infer answers. Keep the same JSON/CSV schema so imports stay compatible.
