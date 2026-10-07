# Academic Record

A free, privacy-first academic record tracker for university students.
Upload your course registration slip and your results, and the app tracks your courses, scores, semester GPA and CGPA automatically.

**Live app:** https://YOUR-USERNAME.github.io/academic-record/

> Replace `YOUR-USERNAME` with your GitHub username.

| Desktop | Dark mode | Phone |
|---|---|---|
| ![Desktop view](docs/screenshot-desktop.png) | ![Dark mode](docs/screenshot-dark.png) | ![Phone view](docs/screenshot-phone.png) |

*Screenshots use invented sample data.*

## What it does

- **Reads your documents for you.** Upload a course registration slip, a course list or a result sheet as PDF, Word (.docx), Excel or CSV.
- **Finds your results.** It locates your row in a class result sheet using your matric or registration number (any format), then fills in your scores and grades.
- **Calculates GPA and CGPA.** Semester GPA and cumulative CGPA update by themselves whenever new results are added. Total credit units and total value points are shown, so you can check them against your school's sheet.
- **Target CGPA calculator.** Type the CGPA you want and see the GPA you need next semester, or whether it is already safe or out of reach.
- **Degree class (optional).** Show your class (First Class, Second Class Upper and so on) with bands you can edit to match your school.
- **Works with any grading scale.** Choose a ready-made scale (5-point, 5-point with D and E, 4-point) or type your own.
- **Handles joining midway.** Enter your previous total units and points or CGPA instead of retyping old semesters.
- **Print or save as PDF.** A clean one-page summary, clearly marked as a personal summary and not an official transcript.
- **Dark mode**, and a layout that works on phones.
- **Never leaves you stuck.** If a file cannot be read automatically, choose the rows yourself, untick columns that are not courses, or type everything in by hand.
- **Optional AI reading** for scans and photos only, as a last resort, using your own free Google Gemini key (see Privacy).

![Target CGPA calculator](docs/screenshot-calculator.png)

## Privacy

- Your records are stored **only in your own browser, on your own device**. There is no server and no account.
- Files are read inside your browser. Nothing is uploaded.
- Visits to the page are counted anonymously (no cookies, no personal data) with GoatCounter.
- The only exception to "nothing is uploaded" is the optional AI reading. If you choose it, that one file is sent to Google using your own free API key, which is saved only in your browser. On the free plan, Google may use what you send to improve its products, so never send a file that contains other people's details.
- **Download a backup now and then.** Clearing your browser data erases your records, and on iPhone, Safari can erase a website's saved data if you don't open it for about a week. Adding the app to your Home Screen reduces this risk. The app reminds you when a backup is due.

## How to use it

1. Open the live app.
2. Save your matric or registration number exactly as it appears in your school's result sheets.
3. Upload your course registration slip to create your semesters and courses.
4. When results are released, upload the result sheet. The app finds your row and matches the courses.
5. Check the preview and click save. If something looks wrong, untick it or fix it by hand.

## Run it yourself

No installation is needed. Download the repository and open `index.html` in a browser. An internet connection is needed for the file-reading libraries (SheetJS, pdf.js and mammoth, loaded from cdnjs).

## Built with

Plain HTML, CSS and JavaScript, with these free libraries:

- [SheetJS](https://sheetjs.com/) for Excel and CSV
- [pdf.js](https://mozilla.github.io/pdf.js/) for PDF
- [mammoth](https://github.com/mwilliamson/mammoth.js) for Word

## How I built it

I wanted a tool that turns the documents my university gives me into my GPA and CGPA without retyping everything. I built it step by step, testing each piece on real course slips and result sheets before moving on. [Edit this paragraph to say, in your own words, how you worked and what you learned. If you used an AI assistant as a tutor and pair-programmer, saying so is honest and shows you can build with modern tools.]

Decisions and problems along the way:

- **Privacy first.** Everything runs in the browser, so no student data ever reaches a server.
- **Matching courses across files.** The same course appears as `ANA201P` on a slip and `ANA 201` on a result sheet, and sometimes with different codes entirely. The app matches by a normalised code first, then by similar titles.
- **Trusting the school's numbers.** Result sheets sometimes disagree with registration slips (credit units, which semester a course counts in). The app uses the result sheet's units so that semester GPAs match the school's own figures, and it shows every change in a preview before saving.
- **Never trusting a guess.** Every automatic or AI reading goes through a preview, and every failure has a manual fallback.
- **Not assuming my school.** Matric numbers, grading scales, pass marks and degree classes are all settings, not hard-coded.
- **Data safety.** Browser storage can be erased, so the app reminds users to back up, with extra advice for iPhone.
- **Last-resort AI that costs nothing to run.** AI reading is optional, appears only when nothing else works, and uses each student's own free key.

## Limitations

- Result sheets must have one row per student and one column per course. Other layouts need the manual row picker or manual entry.
- Course slips are read best when the PDF or Word file has real text. Scans and photos need the optional AI reading.
- Always check the preview. Automatic reading and AI reading can make mistakes.
- Degree class bands differ between schools. Check the defaults against your school's rules.

## Licence

MIT. See the `LICENSE` file.

Built by [YOUR NAME].
