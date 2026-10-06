# Academic Record

A free, privacy-first academic record tracker for university students.
Upload your course registration slip and your results, and the app tracks your courses, scores, semester GPA and CGPA automatically.

**Live app:** https://manuel-fransix9.github.io/Academic-Record/

## What it does

- **Reads your documents for you.** Upload a course registration slip, a course list or a result sheet as PDF, Word (.docx), Excel or CSV.
- **Finds your results.** It locates your row in a class result sheet using your matric or registration number (any format), then fills in your scores and grades.
- **Calculates GPA and CGPA.** Semester GPA and cumulative CGPA update by themselves whenever new results are added. Total credit units and total value points are shown so you can check them against your school's sheet.
- **Works with any grading scale.** Choose a ready-made scale (5-point, 5-point with D and E, 4-point) or type your own.
- **Handles joining midway.** Enter your previous total units and points or CGPA instead of retyping old semesters.
- **Never leaves you stuck.** If a file cannot be read automatically, choose the rows yourself, untick columns that are not courses, or type everything in by hand.
- **Optional AI reading.** For scans and photos only, as a last resort, using your own free Google Gemini key (see Privacy).

## Privacy

- Your records are stored **only in your own browser, on your own device**. There is no server and no account.
- Files are read inside your browser. Nothing is uploaded.
- The only exception is the optional AI reading. If you choose it, that one file is sent to Google using your own free API key, which is saved only in your browser. On the free plan, Google may use what you send to improve its products, so never send a file that contains other people's details.
- Use **Download backup** now and then. Clearing your browser data erases your records.

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

## Limitations

- Result sheets must have one row per student and one column per course. Other layouts need manual entry.
- Course slips are read best when the PDF or Word file has real text. Scans and photos need the optional AI reading.
- Always check the preview. Automatic reading and AI reading can make mistakes.

## About this project

Built by ADINDU EMMANUEL to make tracking results simple for students, and to learn how to build and publish a real web app.

## Licence

MIT. See the `LICENSE` file.
