// =====================================================
// ACADEMIC RECORD - app.js
// Sections: 1 Grades and GPA | 2 Data and helpers | 3 Screen
//           4 Editing | 5 Backup | 5b Backup reminder | 6 Matric number | 6b Settings
//           6c Dark mode, degree class, target calculator, printing
//           7 The upload button | 8 Course slip (PDF)
//           9 Result sheets | 9b Manual mode | 9c AI reading (last resort)
//           10 Course lists | 11 Start
// =====================================================


// ---------- 1. Grades and GPA ----------

// Turn a score (out of 100) into a letter and points, using the grading scale
// from Settings (the scale is kept sorted from the highest score down)
function getGrade(score) {
  for (const g of gradeScale) {
    if (score >= g.min) return { letter: g.letter, points: g.points };
  }
  const last = gradeScale[gradeScale.length - 1];
  return { letter: last.letter, points: last.points };
}

// GPA for one list of courses
function calculateGPA(courses) {
  let totalPoints = 0;
  let totalUnits = 0;

  for (const course of courses) {
    if (course.score === null) continue; // skip courses with no result yet
    const grade = getGrade(course.score);
    totalPoints += grade.points * course.units;
    totalUnits += course.units;
  }

  if (totalUnits === 0) return 0;
  return totalPoints / totalUnits;
}

// Cumulative totals: every scored course, plus any "previous record" you entered
function cumulativeTotals(semesters) {
  let points = previousRecord.points;
  let units = previousRecord.units;
  for (const semester of semesters) {
    for (const course of semester.courses) {
      if (course.score === null) continue;
      points += getGrade(course.score).points * course.units;
      units += course.units;
    }
  }
  return { points: points, units: units };
}

// CGPA = total value points / total credit units, across all semesters
function calculateCGPA(semesters) {
  const t = cumulativeTotals(semesters);
  return t.units === 0 ? 0 : t.points / t.units;
}

function cgpaText(semesters) {
  const t = cumulativeTotals(semesters);
  return t.units === 0 ? "\u2014" : (t.points / t.units).toFixed(2);
}

// True if at least one course has a score
function hasResults(courses) {
  return courses.some(course => course.score !== null);
}

// What to show on screen: a number, or a dash if no results exist yet
function gpaText(courses) {
  return hasResults(courses) ? calculateGPA(courses).toFixed(2) : "\u2014";
}


// ---------- 2. Data and helpers ----------

// Load saved data safely (a damaged save never breaks the page)
function loadSemesters() {
  try {
    const data = JSON.parse(localStorage.getItem("semesters") || "[]");
    return Array.isArray(data) ? data : [];
  } catch (e) {
    return [];
  }
}

let semesters = loadSemesters();   // the app's data: semesters, each holding courses
let pendingUpload = null;          // what was found in an uploaded file, waiting for confirmation
let lastSheets = null;             // the spreadsheet just uploaded (kept for manual mode)
let mapper = null;                 // manual mode: which sheet is being looked at
let lastFile = null;               // the file just uploaded (kept so AI reading can use it)

const AI_BUTTON = `<p><button onclick="startAi()">Try AI reading (last resort)</button></p>`;
const MANUAL_BUTTON = `<p><button onclick="openMapper(lastSheets)">Choose the rows myself</button></p>`;

function save() {
  localStorage.setItem("semesters", JSON.stringify(semesters));
}

// Make text safe to put inside HTML (file contents can contain < > & symbols)
function esc(text) {
  return String(text).replace(/[&<>"']/g, function (ch) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
  });
}

// Remove spaces, slashes and symbols so "20/012345/ABC" and "20 012345 ABC" both match
function clean(text) {
  return String(text).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// The MATCH KEY: "ANA201P", "ANA 201" and "ana-201" all become "ANA201".
// "IUO-GST211" and "GST 211" both become "GST211".
function matchKey(code) {
  return clean(code).replace(/^IUO/, "").replace(/(\d{3})P$/, "$1");
}

// Units the app has learned before, remembered by match key
function getSavedUnits() {
  try {
    return JSON.parse(localStorage.getItem("savedUnits") || "{}");
  } catch (e) {
    return {};
  }
}

// Compare IDs in any format: ignore case, spaces, slashes, dashes and leading zeros
// (Excel drops leading zeros from numbers, so "0123" and 123 must match)
function idKey(text) {
  return clean(text).replace(/^0+/, "");
}

// Words of a course title, for matching courses whose codes differ between files
function titleWords(title) {
  const skip = ["and", "of", "the", "in", "to", "for", "a"];
  return (String(title).toLowerCase().match(/[a-z0-9]+/g) || [])
    .filter(w => !skip.includes(w))
    .map(w => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w));
}

// 0 to 1: how alike two titles are
function titleSimilarity(a, b) {
  const x = new Set(titleWords(a));
  const y = new Set(titleWords(b));
  if (x.size === 0 || y.size === 0) return 0;
  const shared = [...x].filter(w => y.has(w)).length;
  return shared / new Set([...x, ...y]).size;
}

// Find the course in a list that an item from a result sheet belongs to.
// First by match key, then (if codes differ between files) by similar title.
function findCourse(courses, item) {
  const byKey = courses.find(c => matchKey(c.code) === item.key);
  if (byKey) return { course: byKey, byTitle: false };
  const byTitle = courses.find(c => titleSimilarity(c.title, item.title) >= 0.75);
  if (byTitle) return { course: byTitle, byTitle: true };
  return null;
}

// An unscored course with the same code in another semester (the school may have
// graded it in a different semester from the one on your slip)
function findElsewhere(targetIndex, item) {
  for (let i = 0; i < semesters.length; i++) {
    if (i === targetIndex) continue;
    const course = semesters[i].courses.find(c => c.score === null && matchKey(c.code) === item.key);
    if (course) return { course: course, semester: semesters[i] };
  }
  return null;
}

// What will happen to one score: match, title, move or new
function planItem(targetIndex, item) {
  const target = targetIndex >= 0 ? semesters[targetIndex] : null;
  const same = target ? findCourse(target.courses, item) : null;
  if (same) return { kind: same.byTitle ? "title" : "match", course: same.course };
  const elsewhere = findElsewhere(targetIndex, item);
  if (elsewhere) return { kind: "move", course: elsewhere.course, from: elsewhere.semester };
  return { kind: "new" };
}


// ---------- 3. The screen ----------

function addSemester() {
  const input = document.getElementById("semesterName");
  const name = input.value.trim();
  if (name === "") return;
  semesters.push({ name: name, courses: [] });
  input.value = "";
  render();
}

function addCourse(i) {
  const code = document.getElementById("code-" + i).value.trim().toUpperCase();
  const title = document.getElementById("title-" + i).value.trim();
  const units = Number(document.getElementById("units-" + i).value);
  const scoreText = document.getElementById("score-" + i).value.trim();
  const score = scoreText === "" ? null : Number(scoreText);

  if (code === "" || !(units > 0)) return;
  if (score !== null && (score < 0 || score > 100)) return;
  if (semesters[i].courses.some(c => matchKey(c.code) === matchKey(code))) {
    alert(code + " is already in this semester.");
    return;
  }

  semesters[i].courses.push({ code: code, title: title, units: units, score: score, test: null });
  render();
}

// Redraw the whole screen from the data
function render() {
  save();
  const container = document.getElementById("semesters");
  container.innerHTML = "";

  semesters.forEach(function (semester, i) {
    let rows = "";
    semester.courses.forEach(function (course, j) {
      const total = course.score === null ? "" : course.score;
      const test = course.test == null ? "" : course.test;
      const grade = course.score === null ? "-" : getGrade(course.score).letter;
      const exam = (course.score === null || course.test == null) ? "-" : course.score - course.test;

      rows += `<tr>
        <td>${esc(course.code)}</td>
        <td>${esc(course.title)}</td>
        <td>${course.units}</td>
        <td><input class="small" type="number" value="${test}" onchange="updateField(${i}, ${j}, 'test', this.value)"></td>
        <td>${exam}</td>
        <td><input class="small" type="number" value="${total}" onchange="updateField(${i}, ${j}, 'score', this.value)"></td>
        <td>${grade}</td>
        <td class="no-print"><button class="danger" onclick="deleteCourse(${i}, ${j})">\u2715</button></td>
      </tr>`;
    });

    container.innerHTML += `
      <div class="card">
        <h2>${esc(semester.name)}
          <span class="no-print"><button class="danger" onclick="deleteSemester(${i})">Delete semester</button></span>
        </h2>
        <table>
          <tr><th>Code</th><th>Title</th><th>Units</th><th>Test</th><th>Exam</th><th>Total</th><th>Grade</th><th class="no-print"></th></tr>
          ${rows}
        </table>
        <p class="gpa">Semester GPA: ${gpaText(semester.courses)}</p>
        <div class="no-print">
          <input id="code-${i}" placeholder="Code (PCH 201)">
          <input id="title-${i}" placeholder="Title">
          <input id="units-${i}" type="number" placeholder="Units">
          <input id="score-${i}" type="number" placeholder="Total score (optional)">
          <button onclick="addCourse(${i})">Add course</button>
        </div>
      </div>`;
  });

  const totals = cumulativeTotals(semesters);
  document.getElementById("cgpa").textContent = cgpaText(semesters);
  document.getElementById("cgpaDetail").textContent = totals.units > 0
    ? "Total credit units: " + totals.units + "  |  Total value points: " + totals.points
    : "";
  renderDegreeClass();
  renderPrintHeader();
  renderTargetHint();
  renderBackupNotice();
}


// ---------- 4. Editing ----------

// Change a course's test or total score
function updateField(i, j, field, value) {
  const course = semesters[i].courses[j];
  const oldValue = course[field];
  const number = value.trim() === "" ? null : Number(value);

  if (number !== null && (number < 0 || number > 100)) {
    alert("Enter a number from 0 to 100.");
    render();
    return;
  }

  course[field] = number;

  if (course.score !== null && course.test != null && course.test > course.score) {
    alert("The test score can't be more than the total.");
    course[field] = oldValue;
  }
  render();
}

function deleteCourse(i, j) {
  if (!confirm("Delete this course?")) return;
  semesters[i].courses.splice(j, 1);
  render();
}

function deleteSemester(i) {
  if (!confirm("Delete this whole semester and its courses?")) return;
  semesters.splice(i, 1);
  render();
}


// ---------- 5. Backup ----------

function validSemesters(data) {
  return Array.isArray(data) &&
    data.every(s => s && typeof s.name === "string" && Array.isArray(s.courses));
}

// Everything worth keeping, in one object
function buildBackup() {
  return {
    version: 2,
    semesters: semesters,
    gradeScale: gradeScale,
    previousRecord: previousRecord,
    degreeBands: degreeBands,
    showClass: showClass,
    matric: localStorage.getItem("matric") || ""
  };
}

// Put a backup back. Understands the old format (just a list of semesters) too.
function restoreBackup(data) {
  const list = Array.isArray(data) ? data : (data && data.semesters);
  if (!validSemesters(list)) return false;
  semesters = list;

  if (data && !Array.isArray(data)) {
    if (data.gradeScale && validateScale(data.gradeScale) === "") {
      gradeScale = sortScale(data.gradeScale);
      localStorage.setItem("gradeScale", JSON.stringify(gradeScale));
      scaleDraft = gradeScale.map(g => ({ letter: g.letter, min: g.min, points: g.points }));
    }
    if (data.degreeBands && validateBands(data.degreeBands) === "") {
      degreeBands = sortBands(data.degreeBands);
      localStorage.setItem("degreeBands", JSON.stringify(degreeBands));
      bandsDraft = degreeBands.map(b => ({ name: b.name, min: b.min }));
    }
    if (typeof data.showClass === "boolean") {
      showClass = data.showClass;
      localStorage.setItem("showClass", showClass ? "1" : "0");
    }
    const p = data.previousRecord;
    if (p && p.units >= 0 && p.points >= 0) {
      previousRecord = { units: Number(p.units), points: Number(p.points) };
      localStorage.setItem("previousRecord", JSON.stringify(previousRecord));
    }
    if (typeof data.matric === "string" && data.matric.trim() !== "") {
      localStorage.setItem("matric", data.matric);
    }
  }
  return true;
}

// Download all your data as a file
function exportData() {
  const blob = new Blob([JSON.stringify(buildBackup(), null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "academic-record-backup.json";
  link.click();
  localStorage.setItem("backupAt", String(Date.now()));
  localStorage.setItem("backupHash", dataFingerprint());
  renderBackupNotice();
}

// Load data back from a backup file
function importData(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function () {
    try {
      if (!restoreBackup(JSON.parse(reader.result))) throw new Error("not a backup file");
      loadMatric();
      renderScaleEditor();
      renderScaleSummary();
      renderBandsEditor();
      renderPreviousSummary();
      render();
    } catch (e) {
      alert("That file couldn't be read as a backup.");
    }
  };
  reader.readAsText(file);
  event.target.value = "";
}


// ---------- 5b. Backup reminder ----------

// A short code that changes whenever your records change (so we know if a backup is out of date)
function dataFingerprint() {
  const text = JSON.stringify([semesters, previousRecord]);
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return String(h);
}

// The reminder text, or "" if no reminder is needed
function backupNoticeText(now) {
  const hasData = semesters.length > 0 || previousRecord.units > 0;
  if (!hasData) return "";

  const at = Number(localStorage.getItem("backupAt")) || 0;
  const unchanged = localStorage.getItem("backupHash") === dataFingerprint();
  const days = at ? Math.floor((now - at) / 86400000) : 0;
  if (at && unchanged) return "";   // nothing new since the last backup
  if (at && days < 7) return "";    // backed up recently

  const nav = typeof navigator !== "undefined" ? navigator : {};
  const onIphone = /iPhone|iPad|iPod/.test(nav.userAgent || "") && !nav.standalone;

  let text = at
    ? "Your last backup was " + days + " days ago and your records have changed since."
    : "You haven't downloaded a backup yet.";
  text += " Your records live only in this browser, so a backup protects you if the browser data is cleared.";
  if (onIphone) {
    text += " On iPhone, Safari can erase a website's saved data if you don't open it for about a week. " +
            "Tap the Share button and choose Add to Home Screen to reduce this risk.";
  }
  return text;
}

function renderBackupNotice() {
  let box = document.getElementById("backupNotice");
  if (!box) {                                  // create the box under the CGPA banner
    box = document.createElement("div");
    box.id = "backupNotice";
    const anchor = document.getElementById("cgpa").parentElement;
    anchor.parentNode.insertBefore(box, anchor.nextSibling);
  }
  const text = backupNoticeText(Date.now());
  box.innerHTML = text
    ? `<div class="notice no-print">
         <p style="margin:0 0 8px 0">${esc(text)}</p>
         <button onclick="exportData()">Download backup now</button>
       </div>`
    : "";
}

// Ask the browser to keep this site's data (it may refuse; that is fine)
function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
  } catch (e) { /* nothing to do */ }
}


// ---------- 6. Matric number ----------

function saveMatric() {
  const value = document.getElementById("matric").value.trim();
  if (idKey(value).length < 3) {
    alert("Type your matric or registration number exactly as it appears in your result sheets.");
    return;
  }
  localStorage.setItem("matric", value);
  alert("Saved.");
}

function loadMatric() {
  document.getElementById("matric").value = localStorage.getItem("matric") || "";
}


// ---------- 6b. Settings: grading scale and previous record ----------

// Ready-made scales. Students can start from one and change it.
const PRESETS = {
  ng5: {
    label: "5-point, pass mark 50 (A, B, C, F)",
    scale: [
      { letter: "A", min: 70, points: 5 }, { letter: "B", min: 60, points: 4 },
      { letter: "C", min: 50, points: 3 }, { letter: "F", min: 0, points: 0 }
    ]
  },
  ng5de: {
    label: "5-point with D and E (A, B, C, D, E, F)",
    scale: [
      { letter: "A", min: 70, points: 5 }, { letter: "B", min: 60, points: 4 },
      { letter: "C", min: 50, points: 3 }, { letter: "D", min: 45, points: 2 },
      { letter: "E", min: 40, points: 1 }, { letter: "F", min: 0, points: 0 }
    ]
  },
  four: {
    label: "4-point (A, B, C, D, F)",
    scale: [
      { letter: "A", min: 70, points: 4 }, { letter: "B", min: 60, points: 3 },
      { letter: "C", min: 50, points: 2 }, { letter: "D", min: 45, points: 1 },
      { letter: "F", min: 0, points: 0 }
    ]
  }
};

// Returns "" if the scale is fine, otherwise a message saying what is wrong
function validateScale(arr) {
  if (!Array.isArray(arr) || arr.length < 2) return "Add at least two grades.";
  const letters = new Set();
  const mins = new Set();
  for (const g of arr) {
    const letter = String(g.letter || "").trim();
    if (letter === "") return "Every grade needs a letter.";
    if (letters.has(letter.toUpperCase())) return "The grade " + letter + " appears twice.";
    letters.add(letter.toUpperCase());
    if (!Number.isFinite(g.min) || g.min < 0 || g.min > 100) return "'From score' must be a number from 0 to 100 (grade " + letter + ").";
    if (mins.has(g.min)) return "Two grades start at the same score (" + g.min + ").";
    mins.add(g.min);
    if (!Number.isFinite(g.points) || g.points < 0) return "Points must be 0 or more (grade " + letter + ").";
  }
  if (!mins.has(0)) return "One grade must start at 0 (for example F), so every score gets a grade.";
  return "";
}

// Highest score first, so getGrade can walk down the list
function sortScale(arr) {
  return arr
    .map(g => ({ letter: String(g.letter).trim(), min: Number(g.min), points: Number(g.points) }))
    .sort((a, b) => b.min - a.min);
}

function loadScale() {
  try {
    const saved = JSON.parse(localStorage.getItem("gradeScale") || "null");
    if (saved && validateScale(saved) === "") return sortScale(saved);
  } catch (e) { /* fall through to the default */ }
  return sortScale(PRESETS.ng5.scale);
}

function loadPrevious() {
  try {
    const p = JSON.parse(localStorage.getItem("previousRecord") || "null");
    if (p && p.units >= 0 && p.points >= 0) return { units: Number(p.units), points: Number(p.points) };
  } catch (e) { /* fall through */ }
  return { units: 0, points: 0 };
}

let gradeScale = loadScale();                                   // the scale in use
let scaleDraft = gradeScale.map(g => ({ letter: g.letter, min: g.min, points: g.points })); // what is being edited
let previousRecord = loadPrevious();                            // totals from before you started using the app

// --- grading scale screen ---

function renderScaleSummary() {
  const text = gradeScale.map(g => g.letter + " from " + g.min + " = " + g.points).join(", ");
  document.getElementById("scaleSummary").textContent = "In use now: " + text;
}

function fillPresetSelect() {
  document.getElementById("scalePreset").innerHTML =
    `<option value="">Choose a ready-made scale...</option>` +
    Object.keys(PRESETS).map(k => `<option value="${k}">${esc(PRESETS[k].label)}</option>`).join("");
}

function renderScaleEditor() {
  const rows = scaleDraft.map((g, i) => `<tr>
    <td><input class="small" id="gLetter-${i}" value="${esc(g.letter)}"></td>
    <td><input class="small" type="number" id="gMin-${i}" value="${Number.isFinite(g.min) ? g.min : ""}"></td>
    <td><input class="small" type="number" step="0.5" id="gPoints-${i}" value="${Number.isFinite(g.points) ? g.points : ""}"></td>
    <td><button class="danger" onclick="deleteScaleRow(${i})">\u2715</button></td>
  </tr>`).join("");
  document.getElementById("scaleEditor").innerHTML =
    `<table><tr><th>Grade</th><th>From score</th><th>Points</th><th></th></tr>${rows}</table>
     <p><small>"From score" is the lowest score that earns the grade. One grade must start at 0.</small></p>`;
}

// Copy what is typed in the table into scaleDraft
function readScaleDraft() {
  scaleDraft = scaleDraft.map(function (g, i) {
    const letter = document.getElementById("gLetter-" + i);
    const min = document.getElementById("gMin-" + i);
    const points = document.getElementById("gPoints-" + i);
    if (!letter || !min || !points) return g;
    return {
      letter: letter.value.trim(),
      min: min.value === "" ? NaN : Number(min.value),
      points: points.value === "" ? NaN : Number(points.value)
    };
  });
}

function choosePreset(key) {
  if (!key || !PRESETS[key]) return;
  scaleDraft = PRESETS[key].scale.map(g => ({ letter: g.letter, min: g.min, points: g.points }));
  renderScaleEditor();
}

function addScaleRow() {
  readScaleDraft();
  scaleDraft.push({ letter: "", min: NaN, points: NaN });
  renderScaleEditor();
}

function deleteScaleRow(i) {
  readScaleDraft();
  scaleDraft.splice(i, 1);
  renderScaleEditor();
}

function applyScale() {
  readScaleDraft();
  const problem = validateScale(scaleDraft);
  if (problem) {
    alert(problem);
    return;
  }
  gradeScale = sortScale(scaleDraft);
  localStorage.setItem("gradeScale", JSON.stringify(gradeScale));
  scaleDraft = gradeScale.map(g => ({ letter: g.letter, min: g.min, points: g.points }));
  renderScaleEditor();
  renderScaleSummary();
  render();   // every grade, GPA and CGPA is worked out again from the saved scores
  alert("Grading scale saved. All grades and GPAs have been recalculated.");
}

// --- previous record screen ---

function renderPreviousSummary() {
  const box = document.getElementById("prevSummary");
  if (previousRecord.units > 0) {
    const cgpa = (previousRecord.points / previousRecord.units).toFixed(2);
    box.textContent = "Saved: " + previousRecord.units + " units, " + previousRecord.points + " points (CGPA " + cgpa + ").";
  } else {
    box.textContent = "Nothing saved.";
  }
}

function savePrevious() {
  const units = Number(document.getElementById("prevUnits").value);
  const pointsText = document.getElementById("prevPoints").value.trim();
  const cgpaText2 = document.getElementById("prevCgpa").value.trim();
  const topPoints = Math.max(...gradeScale.map(g => g.points));

  if (!(units > 0)) { alert("Enter your total credit units so far."); return; }

  let points;
  if (pointsText !== "") {
    points = Number(pointsText);
  } else if (cgpaText2 !== "") {
    points = Math.round(units * Number(cgpaText2));  // value points are whole numbers, so rounding is safe
  } else {
    alert("Enter either your total value points or your CGPA so far.");
    return;
  }
  if (!(points >= 0) || points > units * topPoints) {
    alert("Those numbers don't fit together. Total points can't be more than units x " + topPoints + ".");
    return;
  }

  previousRecord = { units: units, points: points };
  localStorage.setItem("previousRecord", JSON.stringify(previousRecord));
  renderPreviousSummary();
  render();
}

function clearPrevious() {
  previousRecord = { units: 0, points: 0 };
  localStorage.setItem("previousRecord", JSON.stringify(previousRecord));
  document.getElementById("prevUnits").value = "";
  document.getElementById("prevPoints").value = "";
  document.getElementById("prevCgpa").value = "";
  renderPreviousSummary();
  render();
}


// ---------- 6c. Dark mode, degree class, target calculator, printing ----------

// --- dark mode ---

function applyTheme(theme) {
  if (document.documentElement) document.documentElement.setAttribute("data-theme", theme);
  const button = document.getElementById("themeButton");
  if (button) button.textContent = theme === "dark" ? "Light mode" : "Dark mode";
}

function initialTheme() {
  const saved = localStorage.getItem("theme");
  if (saved === "dark" || saved === "light") return saved;
  const dark = typeof window !== "undefined" && window.matchMedia &&
               window.matchMedia("(prefers-color-scheme: dark)").matches;
  return dark ? "dark" : "light";
}

function toggleTheme() {
  const current = document.documentElement && document.documentElement.getAttribute("data-theme");
  const next = current === "dark" ? "light" : "dark";
  localStorage.setItem("theme", next);
  applyTheme(next);
}

// --- degree class ---

// Common starting points. Schools differ, so students can edit them.
const CLASS_PRESETS = {
  five: {
    label: "5-point classes (First Class from 4.50)",
    bands: [
      { name: "First Class", min: 4.5 }, { name: "Second Class Upper", min: 3.5 },
      { name: "Second Class Lower", min: 2.4 }, { name: "Third Class", min: 1.5 }, { name: "Pass", min: 1 }
    ]
  },
  four: {
    label: "4-point classes (First Class from 3.50)",
    bands: [
      { name: "First Class", min: 3.5 }, { name: "Second Class Upper", min: 3 },
      { name: "Second Class Lower", min: 2 }, { name: "Third Class", min: 1 }
    ]
  }
};

// Returns "" if the classes are fine, otherwise a message saying what is wrong
function validateBands(arr) {
  if (!Array.isArray(arr) || arr.length < 1) return "Add at least one class.";
  const top = Math.max(...gradeScale.map(g => g.points));
  const names = new Set();
  const mins = new Set();
  for (const b of arr) {
    const name = String(b.name || "").trim();
    if (name === "") return "Every class needs a name.";
    if (names.has(name.toLowerCase())) return "The class " + name + " appears twice.";
    names.add(name.toLowerCase());
    if (!Number.isFinite(b.min) || b.min < 0 || b.min > top) return "'From CGPA' must be a number from 0 to " + top + " (" + name + ").";
    if (mins.has(b.min)) return "Two classes start at the same CGPA (" + b.min + ").";
    mins.add(b.min);
  }
  return "";
}

// Highest first, so the first match is the right class
function sortBands(arr) {
  return arr.map(b => ({ name: String(b.name).trim(), min: Number(b.min) })).sort((a, b) => b.min - a.min);
}

function loadBands() {
  try {
    const saved = JSON.parse(localStorage.getItem("degreeBands") || "null");
    if (Array.isArray(saved) && validateBands(saved) === "") return sortBands(saved);
  } catch (e) { /* use the default below */ }
  return sortBands(CLASS_PRESETS.five.bands);
}

let degreeBands = loadBands();
let bandsDraft = degreeBands.map(b => ({ name: b.name, min: b.min }));
let showClass = localStorage.getItem("showClass") === "1";   // off until the student turns it on

// The class for a CGPA, judged on the two decimals the student sees
function classFor(cgpa) {
  const rounded = Math.round(cgpa * 100) / 100;
  const band = degreeBands.find(b => rounded >= b.min);
  return band ? band.name : "";
}

function renderDegreeClass() {
  const el = document.getElementById("degreeClass");
  if (!el) return;
  const t = cumulativeTotals(semesters);
  el.textContent = (!showClass || t.units === 0) ? "" : "\u00B7 " + (classFor(t.points / t.units) || "below the lowest class");
}

function setShowClass(on) {
  showClass = !!on;
  localStorage.setItem("showClass", showClass ? "1" : "0");
  render();
}

function renderBandsEditor() {
  const rows = bandsDraft.map((b, i) => `<tr>
    <td><input id="bName-${i}" value="${esc(b.name)}"></td>
    <td><input class="small" type="number" step="0.01" id="bMin-${i}" value="${Number.isFinite(b.min) ? b.min : ""}"></td>
    <td><button class="danger" onclick="deleteBandRow(${i})">\u2715</button></td>
  </tr>`).join("");
  document.getElementById("bandsEditor").innerHTML =
    `<table><tr><th>Class</th><th>From CGPA</th><th></th></tr>${rows}</table>`;
  document.getElementById("showClassBox").checked = showClass;
  const select = document.getElementById("bandsPreset");
  select.innerHTML = `<option value="">Choose a starting point...</option>` +
    Object.keys(CLASS_PRESETS).map(k => `<option value="${k}">${esc(CLASS_PRESETS[k].label)}</option>`).join("");
}

function readBandsDraft() {
  bandsDraft = bandsDraft.map(function (b, i) {
    const name = document.getElementById("bName-" + i);
    const min = document.getElementById("bMin-" + i);
    if (!name || !min) return b;
    return { name: name.value.trim(), min: min.value === "" ? NaN : Number(min.value) };
  });
}

function chooseBandPreset(key) {
  if (!key || !CLASS_PRESETS[key]) return;
  bandsDraft = CLASS_PRESETS[key].bands.map(b => ({ name: b.name, min: b.min }));
  renderBandsEditor();
}

function addBandRow() {
  readBandsDraft();
  bandsDraft.push({ name: "", min: NaN });
  renderBandsEditor();
}

function deleteBandRow(i) {
  readBandsDraft();
  bandsDraft.splice(i, 1);
  renderBandsEditor();
}

function applyBands() {
  readBandsDraft();
  const problem = validateBands(bandsDraft);
  if (problem) {
    alert(problem);
    return;
  }
  degreeBands = sortBands(bandsDraft);
  localStorage.setItem("degreeBands", JSON.stringify(degreeBands));
  bandsDraft = degreeBands.map(b => ({ name: b.name, min: b.min }));
  renderBandsEditor();
  render();
  alert("Degree classes saved.");
}

// --- target CGPA calculator ---

// Units for courses still waiting for results (a good guess for "next semester")
function suggestedUnits() {
  let units = 0;
  semesters.forEach(s => s.courses.forEach(c => { if (c.score === null) units += c.units; }));
  return units;
}

// What GPA is needed next semester to reach a target CGPA?
function targetPlan(totals, target, nextUnits, topPoints, lowPoints) {
  const P = totals.points;
  const U = totals.units;
  const required = (target * (U + nextUnits) - P) / nextUnits;
  const best = (P + nextUnits * topPoints) / (U + nextUnits);
  const worst = (P + nextUnits * lowPoints) / (U + nextUnits);

  let status = "possible";
  if (worst >= target) status = "safe";             // even the lowest grades keep you at the target
  else if (best < target) status = "out of reach";  // even top grades are not enough in one semester

  // Semesters of the same size with top grades needed, when one semester is not enough
  let semestersNeeded = null;
  if (status === "out of reach" && target < topPoints) {
    semestersNeeded = Math.ceil((target * U - P) / (nextUnits * (topPoints - target)));
  }
  return { required: required, best: best, worst: worst, status: status, semestersNeeded: semestersNeeded };
}

// "an A", "an F", "a B"
function withArticle(letter) {
  return (/^[AEFHILMNORSX]/i.test(letter) ? "an " : "a ") + letter;
}

// Say a GPA in grade words, using the student's own scale
function describeAverage(points) {
  const levels = [...new Map(gradeScale.map(g => [g.points, g.letter])).entries()].sort((a, b) => a[0] - b[0]);
  const exact = levels.find(l => Math.abs(l[0] - points) < 0.005);
  if (exact) return "an average of " + exact[1];
  const lower = [...levels].reverse().find(l => l[0] < points);
  const upper = levels.find(l => l[0] > points);
  if (lower && upper) return "between " + withArticle(lower[1]) + " and " + withArticle(upper[1]) + " average";
  return "";
}

function renderTargetHint() {
  const units = document.getElementById("targetUnits");
  if (units) {
    const guess = suggestedUnits();
    units.placeholder = guess > 0 ? guess + " (units waiting for results)" : "e.g. 24";
  }
  const wrap = document.getElementById("targetClassWrap");
  const select = document.getElementById("targetClass");
  if (wrap && select) {
    wrap.style.display = showClass ? "" : "none";
    const keep = select.value;
    select.innerHTML = `<option value="">choose a class...</option>` +
      degreeBands.map(b => `<option value="${b.min}">${esc(b.name)} (${b.min})</option>`).join("");
    select.value = keep;
  }
}

function useTargetClass(value) {
  if (value !== "") document.getElementById("targetCgpa").value = value;
}

function calculateTarget() {
  const out = document.getElementById("targetResult");
  const totals = cumulativeTotals(semesters);
  const points = gradeScale.map(g => g.points);
  const top = Math.max(...points);
  const low = Math.min(...points);

  const target = Number(document.getElementById("targetCgpa").value);
  let units = Number(document.getElementById("targetUnits").value);
  if (!(units > 0)) units = suggestedUnits();

  if (!(target > 0) || target > top) {
    out.textContent = "Type a target CGPA between 0 and " + top + ".";
    return;
  }
  if (!(units > 0)) {
    out.textContent = "Type how many credit units you will take next semester.";
    return;
  }

  const plan = targetPlan(totals, target, units, top, low);
  const now = totals.units > 0 ? "Your CGPA now is " + (totals.points / totals.units).toFixed(2) + ". " : "";
  let text;

  if (plan.status === "safe") {
    text = "Good news: you are already there. Even with the lowest grades next semester, your CGPA would stay at " +
           plan.worst.toFixed(2) + ", which is at or above " + target + ".";
  } else if (plan.status === "out of reach") {
    text = "It can't be done in one semester of " + units + " units: even top grades in every course would only take you to " +
           plan.best.toFixed(2) + ".";
    if (plan.semestersNeeded) {
      text += " With top grades in every course it would take about " + plan.semestersNeeded + " semesters of this size.";
    } else {
      text += " The target is higher than the top grade points can reach.";
    }
  } else {
    const words = describeAverage(plan.required);
    text = "To reach a CGPA of " + target + ", you need a GPA of at least " + plan.required.toFixed(2) +
           " next semester (" + units + " units)." + (words ? " On your scale that is " + words + "." : "");
  }
  out.textContent = now + text;
}

// --- printing / saving as PDF ---

function renderPrintHeader() {
  const el = document.getElementById("printHeader");
  if (!el) return;
  const id = localStorage.getItem("matric") || "";
  el.innerHTML = `<h2>Academic Record: personal summary</h2>
    <p>${id ? "Matric / ID: " + esc(id) + " &nbsp;|&nbsp; " : ""}Printed: ${esc(new Date().toLocaleDateString())}</p>
    <p><em>Calculated by the student with the Academic Record app. This is not an official transcript.</em></p>`;
}

if (typeof window !== "undefined" && window.addEventListener) {
  window.addEventListener("beforeprint", renderPrintHeader);   // keep the date fresh
}


// ---------- 7. The upload button ----------

// Every file goes through here. It works out what the file is.
async function handleUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  const box = document.getElementById("uploadPreview");
  box.innerHTML = "<p>Reading the file...</p>";
  pendingUpload = null;
  lastFile = file;

  try {
    const name = file.name.toLowerCase();
    if (/\.(jpe?g|png|webp)$/.test(name)) {
      box.innerHTML = "<p>That is a picture, and I can't read pictures on my own. The best option is to type your courses in under \"Add a semester\". If that is not possible, AI reading can try.</p>" + AI_BUTTON;
    } else if (name.endsWith(".pdf")) {
      await handlePdf(file, box);
    } else if (name.endsWith(".docx")) {
      await handleWord(file, box);
    } else if (name.endsWith(".doc")) {
      box.innerHTML = "<p>That is an old Word format (.doc). Open it in Word, choose Save As, pick \".docx\", and upload the new file.</p>";
    } else if (/\.(xlsx|xls|csv)$/.test(name)) {
      await handleSpreadsheet(file, box);
    } else {
      box.innerHTML = "<p>I can read PDF, Word (.docx), Excel (.xlsx, .xls) and CSV files, and pictures with AI reading. For anything else, type your courses in under \"Add a semester\" (it only takes a minute), or save the file in one of those formats and try again.</p>";
    }
  } catch (err) {
    box.innerHTML = "<p>Something went wrong reading that file (" + esc(err.message) + "). You can still type your courses in under \"Add a semester\".</p>";
  } finally {
    event.target.value = ""; // lets you choose the same file again
  }
}

async function handleSpreadsheet(file, box) {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const sheets = workbook.SheetNames.map(function (name) {
    const ws = workbook.Sheets[name];
    return {
      name: name,
      // rowOffset keeps row numbers the same as in Excel when the sheet starts below row 1
      rowOffset: ws["!ref"] ? XLSX.utils.decode_range(ws["!ref"]).s.r : 0,
      rows: XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" })
    };
  });
  processSheets(sheets, box);
}

// Works out what a set of sheets contains (from Excel, CSV or Word tables)
function processSheets(sheets, box) {
  lastSheets = sheets;

  // The student asked to choose the rows by hand
  if (document.getElementById("manualMode").checked) {
    openMapper(sheets);
    return;
  }

  // 1. Is it a result sheet with my row in it?
  const matric = localStorage.getItem("matric");
  const blocks = matric ? findMyBlocks(sheets, matric) : [];
  if (blocks.length > 0) {
    blocks.forEach(chooseTarget);
    markDuplicateBlocks(blocks);
    pendingUpload = { kind: "results", blocks: blocks };
    showResultsPreview(box);
    return;
  }

  // 2. It looks like a result sheet (course codes across a header, many rows below)
  const looksLikeResults = sheets.some(function (s) {
    for (let r = 0; r < s.rows.length; r++) {
      if (codeCells(s.rows[r]).length >= 3) return s.rows.length - r > 5;
    }
    return false;
  });
  if (looksLikeResults) {
    box.innerHTML = (matric
      ? "<p>This looks like a result sheet, but I couldn't find \"" + esc(matric) + "\" in it. Check that what you saved above is written the way the sheet writes it, or choose your row yourself.</p>"
      : "<p>This looks like a result sheet. Save your matric or registration number above, then upload it again. Or choose your row yourself.</p>")
      + MANUAL_BUTTON;
    return;
  }

  // 3. Otherwise treat it as a course list
  let courses = [];
  for (const sheet of sheets) {
    courses = extractCourses(sheet.rows);
    if (courses.length === 0) courses = coursesFromHeader(sheet.rows);
    if (courses.length > 0) break;
  }
  if (courses.length === 0) {
    box.innerHTML = "<p>I couldn't find any courses in this file. You can show me where they are, or type them in under \"Add a semester\".</p>" + MANUAL_BUTTON;
    return;
  }
  pendingUpload = { kind: "courses", courses: courses, target: semesters.length ? 0 : -1, newName: "New semester" };
  showCoursesPreview(box);
}

// Word files (.docx): read the text and the tables
async function handleWord(file, box) {
  if (typeof mammoth === "undefined") {
    box.innerHTML = "<p>The Word reader didn't load. Check your internet connection and refresh the page.</p>";
    return;
  }
  const result = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
  const doc = new DOMParser().parseFromString(result.value, "text/html");

  // Text of a cell or paragraph (a cell can hold several lines)
  const textOf = function (el) {
    const lines = Array.from(el.querySelectorAll("p")).map(p => p.textContent.trim()).filter(t => t !== "");
    return lines.length ? lines.join(" ") : el.textContent.trim();
  };

  // 1. All the text in order, like the PDF reader, to look for a course slip
  const tokens = [];
  doc.body.querySelectorAll("p, h1, h2, h3, h4, h5, h6, td, th").forEach(function (el) {
    const isCell = el.tagName === "TD" || el.tagName === "TH";
    if (!isCell && el.closest("td, th")) return;   // this text is read through its cell
    const text = textOf(el);
    if (text) tokens.push(text);
  });

  const slip = parseSlip(tokens);
  if (slip.semesters.some(s => s.courses.length > 0)) {
    pendingUpload = { kind: "slip", slip: slip };
    showSlipPreview(box);
    return;
  }

  // 2. Otherwise treat every table like a sheet in a spreadsheet
  const sheets = Array.from(doc.querySelectorAll("table")).map(function (table, i) {
    const rows = Array.from(table.rows).map(function (tr) {
      const cells = [];
      Array.from(tr.cells).forEach(function (td) {
        cells.push(textOf(td));
        for (let k = 1; k < (td.colSpan || 1); k++) cells.push("");   // keep columns lined up
      });
      return cells;
    });
    return { name: "Table " + (i + 1), rowOffset: 0, rows: rows };
  }).filter(sh => sh.rows.length > 0);

  if (sheets.length === 0) {
    box.innerHTML = "<p>I couldn't find a course list or table in this Word file. Type your courses in under \"Add a semester\", or paste the table into Excel and upload that.</p>";
    return;
  }
  processSheets(sheets, box);
}

// Called when a preview is finished or cancelled
function finishUpload() {
  pendingUpload = null;
  mapper = null;
  document.getElementById("uploadPreview").innerHTML = "";
  render();
}


// ---------- 8. Course registration slip (PDF) ----------

if (typeof pdfjsLib !== "undefined") {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}

const SLIP_CODE = /^[A-Z]{2,4}(?:-[A-Z]{2,4})?\d{3}P?$/;

// "ANA201P" becomes "ANA 201P"
function formatCode(code) {
  return code.replace(/^([A-Z]{2,4}(?:-[A-Z]{2,4})?)(\d{3}P?)$/, "$1 $2");
}

// Turn the text pieces from a slip into semesters and courses
function parseSlip(tokens) {
  const result = { level: "", session: "", matric: "", totalCredits: 0, semesters: [] };

  tokens.forEach(function (t, i) {
    if (t === "Session:" && !result.session) result.session = tokens[i + 1] || "";
    if (t === "Matriculation Number:") result.matric = (tokens[i + 1] || "").toUpperCase();
    if (t === "Total Credits:") result.totalCredits = Number(tokens[i + 1]) || 0;
    const lv = t.match(/Registration Slip (\d{3})/i);
    if (lv && !result.level) result.level = lv[1];
  });

  let current = null;   // the semester being read
  let segment = null;   // the course being read

  function finishCourse() {
    if (segment && current) {
      const parts = segment.pieces;
      // the last three pieces of a course are: department, college, credits
      for (let k = parts.length - 3; k >= 1; k--) {
        if (/^[A-Z]{2,4}$/.test(parts[k]) && /^[A-Z]{2,4}$/.test(parts[k + 1]) && /^\d{1,2}$/.test(parts[k + 2])) {
          current.courses.push({
            code: formatCode(segment.code),
            title: parts.slice(0, k).join(" ").replace(/\s+/g, " ").trim(),
            units: Number(parts[k + 2]),
            score: null,
            test: null
          });
          break;
        }
      }
    }
    segment = null;
  }

  tokens.forEach(function (t) {
    const heading = t.match(/^(\d)(?:st|nd|rd|th)\s+Semester/i);
    if (heading) {
      finishCourse();
      current = { number: Number(heading[1]), courses: [] };
      result.semesters.push(current);
    } else if (current && SLIP_CODE.test(t)) {
      finishCourse();
      segment = { code: t, pieces: [] };
    } else if (segment) {
      segment.pieces.push(t);
    }
  });
  finishCourse();
  return result;
}

function slipSemesterName(slip, semester) {
  const words = { 1: "First", 2: "Second", 3: "Third" };
  const label = words[semester.number] || semester.number + "th";
  const level = slip.level ? slip.level + " Level - " : "";
  const session = slip.session ? " (" + slip.session + ")" : "";
  return level + label + " Semester" + session;
}

async function handlePdf(file, box) {
  if (typeof pdfjsLib === "undefined") {
    box.innerHTML = "<p>The PDF reader didn't load. Check your internet connection and refresh the page.</p>";
    return;
  }

  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data: data }).promise;
  const tokens = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    content.items.forEach(function (item) {
      const text = item.str.trim();
      if (text) tokens.push(text);
    });
  }

  if (tokens.length === 0) {
    box.innerHTML = "<p>This PDF has no readable text, so it is probably a scan or a photo. First choice: try a copy downloaded straight from your school portal, or type your courses in under \"Add a semester\". If neither is possible, AI reading can try.</p>" + AI_BUTTON;
    return;
  }

  const slip = parseSlip(tokens);
  if (slip.semesters.every(s => s.courses.length === 0)) {
    box.innerHTML = "<p>I couldn't find a course list in this PDF. If it is a result sheet, ask for the Excel version if you can, or type your courses in under \"Add a semester\". If neither is possible, AI reading can try.</p>" + AI_BUTTON;
    return;
  }
  pendingUpload = { kind: "slip", slip: slip };
  showSlipPreview(box);
}

function showSlipPreview(box) {
  const slip = pendingUpload.slip;
  const total = slip.semesters.flatMap(s => s.courses).reduce((sum, c) => sum + c.units, 0);

  let check = "";
  if (slip.totalCredits) {
    check = total === slip.totalCredits
      ? `<p>\u2705 The units add up to ${total}, which matches the total on your slip.</p>`
      : `<p>\u26A0\uFE0F The units I found add up to ${total}, but your slip says ${slip.totalCredits}. Please check the lists below.</p>`;
  }

  const tables = slip.semesters.map(function (s) {
    const rows = s.courses.map(c =>
      `<tr><td>${esc(c.code)}</td><td>${esc(c.title)}</td><td>${c.units}</td></tr>`).join("");
    return `<h3>${esc(slipSemesterName(slip, s))}</h3>
      <table><tr><th>Code</th><th>Title</th><th>Units</th></tr>${rows}</table>`;
  }).join("");

  const note = pendingUpload.note ? `<p><em>${esc(pendingUpload.note)}</em></p>` : "";
  box.innerHTML = note + check + tables + `<button onclick="confirmSlip()">Create these semesters</button>`;
}

function confirmSlip() {
  const slip = pendingUpload.slip;
  const saved = getSavedUnits();

  slip.semesters.forEach(function (s) {
    const name = slipSemesterName(slip, s);
    let target = semesters.find(x => x.name.toLowerCase() === name.toLowerCase());
    if (!target) {
      target = { name: name, courses: [] };
      semesters.push(target);
    }
    s.courses.forEach(function (c) {
      saved[matchKey(c.code)] = c.units;
      if (!target.courses.some(x => matchKey(x.code) === matchKey(c.code))) target.courses.push(c);
    });
  });
  localStorage.setItem("savedUnits", JSON.stringify(saved));

  // If no matric number is saved yet, take it from the slip
  if (!localStorage.getItem("matric") && idKey(slip.matric).length >= 3) {
    localStorage.setItem("matric", slip.matric);
    loadMatric();
  }
  finishUpload();
}


// ---------- 9. Result sheets ----------

const CODE_PATTERN = /([A-Z]{2,4}(?:-[A-Z]{2,4})?)\s*(\d{3})/g;

// Find every cell in a row that contains a course code, and work out its title
function codeCells(row) {
  const items = [];
  row.forEach(function (cell, col) {
    const text = String(cell);
    const matches = [...text.toUpperCase().matchAll(CODE_PATTERN)];
    if (matches.length === 0) return;
    const m = matches[matches.length - 1];
    // title = the cell without the code, without tags like "(C)", without stray brackets
    let title = text.slice(0, m.index) + " " + text.slice(m.index + m[0].length);
    title = title.replace(/\(\s*[A-Za-z]?\s*\)/g, " ").replace(/\s+/g, " ");
    title = title.replace(/^[\s:;,\-]+|[\s:;,\-]+$/g, "");
    items.push({ col: col, code: m[1] + " " + m[2], title: title });
  });
  return items;
}

// Walk upwards from a row to find the header row (3 or more course codes)
function findHeaderAbove(rows, fromRow) {
  for (let r = fromRow - 1; r >= 0; r--) {
    const items = codeCells(rows[r]);
    if (items.length >= 3) return { row: r, items: items };
  }
  return null;
}

// The credit-unit row sits just under the header: mostly small numbers (1 to 9)
function findUnitsRow(rows, header) {
  for (let k = header.row + 1; k <= header.row + 3 && k < rows.length; k++) {
    const row = rows[k] || [];
    const small = header.items.filter(function (it) {
      const v = Number(row[it.col]);
      return row[it.col] !== "" && v >= 1 && v <= 9;
    }).length;
    if (small >= 2 && small >= header.items.length * 0.6) return row;
  }
  return null;
}

// Read my scores: one item for every header column where my row holds a number
function readScores(headerItems, myRowCells, unitsRowCells) {
  const items = [];
  headerItems.forEach(function (item) {
    const m = String(myRowCells[item.col]).trim().match(/^(\d+(\.\d+)?)/); // "50C" gives 50
    if (!m) return;                                    // blank, ABSENT, INDEBTED...
    const score = Number(m[1]);
    if (score > 100) return;
    const key = matchKey(item.code);
    if (items.some(x => x.key === key)) return;        // duplicate column
    const units = unitsRowCells ? Number(unitsRowCells[item.col]) : 0;
    items.push({
      code: item.code,
      key: key,
      title: item.title,
      units: units >= 1 && units <= 9 ? units : 0,
      score: score,
      include: true
    });
  });
  return items;
}

// Find my row in every sheet and read my scores
function findMyBlocks(sheets, id) {
  const target = idKey(id);
  const blocks = [];
  if (target === "") return blocks;

  sheets.forEach(function (sheet) {
    const rows = sheet.rows;
    const myRow = rows.findIndex(row => row.some(cell => idKey(cell) === target));
    if (myRow === -1) return;
    const header = findHeaderAbove(rows, myRow);
    if (!header) return;
    const unitsRow = findUnitsRow(rows, header);
    const items = readScores(header.items, rows[myRow], unitsRow);

    const name = String(sheet.name).trim();
    blocks.push({ sheetName: name, items: items, target: -1, newName: name, include: true, note: "" });
  });
  return blocks;
}

// Pick the semester whose courses match the most of my scores
function chooseTarget(block) {
  let best = -1;
  let bestCount = 0;
  semesters.forEach(function (s, i) {
    const count = block.items.filter(item => findCourse(s.courses, item)).length;
    if (count > bestCount) { best = i; bestCount = count; }
  });
  block.target = best;   // -1 means: create a new semester
}

// If two sheets hold the same courses (for example a provisional and a final
// result), tick only the later one by default
function markDuplicateBlocks(blocks) {
  for (let a = 0; a < blocks.length; a++) {
    for (let b = a + 1; b < blocks.length; b++) {
      const first = blocks[a];
      const later = blocks[b];
      if (first.items.length === 0 || later.items.length === 0) continue;
      const shared = first.items.filter(x => later.items.some(y => y.key === x.key)).length;
      if (shared >= Math.min(first.items.length, later.items.length) * 0.6) {
        first.include = false;
        first.note = "Not ticked: \"" + later.sheetName + "\" has the same courses and comes later. Tick this box instead if this is the sheet you want.";
      }
    }
  }
}

// Keep anything typed or ticked in the preview before it is redrawn
function readTypedValues() {
  if (!pendingUpload || pendingUpload.kind !== "results") return;
  pendingUpload.blocks.forEach(function (b, bi) {
    const tick = document.getElementById("include-" + bi);
    if (tick) b.include = tick.checked;
    const nameInput = document.getElementById("newName-" + bi);
    if (nameInput && nameInput.value.trim() !== "") b.newName = nameInput.value;
    b.items.forEach(function (item, ii) {
      const el = document.getElementById("newUnits-" + bi + "-" + ii);
      if (el && Number(el.value) > 0) item.units = Number(el.value);
      const tick2 = document.getElementById("item-" + bi + "-" + ii);
      if (tick2) item.include = tick2.checked;
    });
  });
}

function changeTarget(bi, value) {
  readTypedValues();
  pendingUpload.blocks[bi].target = Number(value);
  showResultsPreview(document.getElementById("uploadPreview"));
}

function showResultsPreview(box) {
  const blocks = pendingUpload.blocks;

  if (blocks.every(b => b.items.length === 0)) {
    box.innerHTML = "<p>I found your row, but there are no scores in it. The sheet may say ABSENT or INDEBTED, or your results may not be released yet.</p>";
    return;
  }

  const html = blocks.map(function (b, bi) {
    if (b.items.length === 0) return "";

    const options = semesters.map((s, i) =>
      `<option value="${i}" ${b.target === i ? "selected" : ""}>${esc(s.name)}</option>`).join("") +
      `<option value="-1" ${b.target === -1 ? "selected" : ""}>+ Create a new semester</option>`;

    const rows = b.items.map(function (item, ii) {
      const plan = planItem(b.target, item);
      let code = item.code;
      let title = item.title;
      let unitsCell;
      let status;

      if (plan.kind === "new") {
        const u = item.units || getSavedUnits()[item.key] || "";
        unitsCell = `<input class="small" type="number" id="newUnits-${bi}-${ii}" value="${u}" placeholder="?">`;
        status = "new course";
      } else {
        const was = plan.course.units;
        code = plan.course.code;
        title = plan.course.title || item.title;
        unitsCell = item.units && item.units !== was
          ? `${item.units} <small>(was ${was})</small>` : was;
        status = plan.kind === "match" ? "in your course list"
               : plan.kind === "title" ? "matched by title"
               : "moves here from " + esc(plan.from.name);
      }
      return `<tr><td><input type="checkbox" id="item-${bi}-${ii}" ${item.include ? "checked" : ""}></td>
        <td>${esc(code)}</td><td>${esc(title)}</td><td>${unitsCell}</td>
        <td>${item.score}</td><td>${getGrade(item.score).letter}</td><td>${status}</td></tr>`;
    }).join("");

    return `<h3><label><input type="checkbox" id="include-${bi}" ${b.include ? "checked" : ""}>
        Found you in "${esc(b.sheetName)}": ${b.items.length} results</label></h3>
      ${b.note ? `<p><em>${esc(b.note)}</em></p>` : ""}
      <p>Add them to: <select onchange="changeTarget(${bi}, this.value)">${options}</select></p>
      ${b.target === -1 ? `<p>Name for the new semester: <input id="newName-${bi}" value="${esc(b.newName)}"></p>` : ""}
      <table><tr><th></th><th>Code</th><th>Title</th><th>Units</th><th>Score</th><th>Grade</th><th></th></tr>${rows}</table>`;
  }).join("");

  box.innerHTML = html + `<p><small>Untick any row that is not one of your courses.</small></p>
    <button onclick="confirmResults()">Save the ticked results</button>`;
}

function confirmResults() {
  readTypedValues();
  const blocks = pendingUpload.blocks.filter(b => b.include && b.items.some(i => i.include));
  if (blocks.length === 0) {
    alert("Nothing is ticked.");
    return;
  }

  // Check first, so nothing is half-saved
  for (const b of blocks) {
    for (const item of b.items.filter(i => i.include)) {
      if (planItem(b.target, item).kind === "new" && !(item.units > 0)) {
        alert("Please fill in the units for " + item.code + ".");
        return;
      }
    }
  }

  const saved = getSavedUnits();
  blocks.forEach(function (b) {
    let target = b.target >= 0 ? semesters[b.target] : null;
    const chosen = b.items.filter(i => i.include);
    const plans = chosen.map(item => planItem(b.target, item));
    if (!target) {
      target = { name: b.newName.trim() || b.sheetName, courses: [] };
      semesters.push(target);
    }
    chosen.forEach(function (item, idx) {
      const plan = plans[idx];
      if (plan.kind === "new") {
        saved[item.key] = item.units;
        target.courses.push({ code: item.code, title: item.title, units: item.units, score: item.score, test: null });
        return;
      }
      const course = plan.course;
      course.score = item.score;
      if (item.units > 0) course.units = item.units;   // the result sheet's units are what the school used
      if (plan.kind === "move") {
        plan.from.courses.splice(plan.from.courses.indexOf(course), 1);
        target.courses.push(course);
      }
    });
  });
  localStorage.setItem("savedUnits", JSON.stringify(saved));
  finishUpload();
}


// ---------- 9b. Manual mode: you choose the rows ----------

// Header words that are not courses (used to leave them unticked by default)
const NOT_A_COURSE = /\b(matric|reg|name|s\/n|sn|sex|gender|total|gpa|cgpa|average|remarks?|tcr|tvp|ctcr|ctvp|points?|units?|credits?|status|position|outstanding|cumulative|semester|session|grade)\b|\bno\.?\s+of\b/i;

// One item per non-empty header cell. Cells without a course code use their text as the name.
function itemsFromHeaderRow(row) {
  const byCol = new Map(codeCells(row).map(i => [i.col, i]));
  const items = [];
  row.forEach(function (cell, col) {
    const text = String(cell).trim();
    if (text === "") return;
    const found = byCol.get(col);
    items.push(found
      ? { col: col, code: found.code, title: found.title, hasCode: true }
      : { col: col, code: text.slice(0, 40), title: text, hasCode: false });
  });
  return items;
}

function openMapper(sheets) {
  mapper = { sheets: sheets, sheetIndex: 0 };
  renderMapper();
}

function setMapperSheet(i) {
  mapper.sheetIndex = Number(i);
  renderMapper();
}

function renderMapper() {
  const box = document.getElementById("uploadPreview");
  const sheet = mapper.sheets[mapper.sheetIndex];

  const grid = sheet.rows.slice(0, 15).map(function (row, r) {
    const cells = row.slice(0, 30).map(c => `<td class="grid-cell">${esc(String(c).slice(0, 22))}</td>`).join("");
    return `<tr><td class="grid-rownum"><b>${r + sheet.rowOffset + 1}</b></td>${cells}</tr>`;
  }).join("");

  const picker = mapper.sheets.length > 1
    ? `<p>Sheet: <select onchange="setMapperSheet(this.value)">${mapper.sheets.map((sh, i) =>
        `<option value="${i}" ${i === mapper.sheetIndex ? "selected" : ""}>${esc(String(sh.name).trim())}</option>`).join("")}</select></p>`
    : "";

  box.innerHTML = `
    <h3>Choose the rows yourself</h3>
    ${picker}
    <p>This is the top of your sheet. The grey numbers are row numbers, the same as in Excel.</p>
    <div style="overflow-x:auto;font-size:12px"><table style="width:auto">${grid}</table></div>
    <p>1. Row with the <b>course names</b>: <input class="small" type="number" id="mapHeader"></p>
    <p>2. Row with the <b>credit units</b> (leave empty if there isn't one): <input class="small" type="number" id="mapUnits"></p>
    <p>3. <b>Your row</b>: <input class="small" type="number" id="mapMy"></p>
    <p>Not sure which row is yours? Search for your name or number:
      <input id="mapSearch" value="${esc(localStorage.getItem("matric") || "")}">
      <button onclick="searchMyRow()">Search</button></p>
    <div id="mapResults"></div>
    <button onclick="readManual()">Read my results</button>`;
}

function searchMyRow() {
  const sheet = mapper.sheets[mapper.sheetIndex];
  const wanted = clean(document.getElementById("mapSearch").value);
  const out = document.getElementById("mapResults");
  if (wanted.length < 3) {
    out.innerHTML = "<p>Type at least 3 letters or numbers.</p>";
    return;
  }
  const hits = [];
  sheet.rows.forEach(function (row, r) {
    if (hits.length < 8 && row.some(c => clean(c).includes(wanted))) hits.push(r);
  });
  if (hits.length === 0) {
    out.innerHTML = "<p>Nothing found. Try a shorter piece of your name or number.</p>";
    return;
  }
  out.innerHTML = hits.map(function (r) {
    const line = sheet.rows[r].map(c => String(c).trim()).filter(c => c !== "").slice(0, 6).join(" | ");
    const n = r + sheet.rowOffset + 1;
    return `<p>Row ${n}: ${esc(line)} <button onclick="useMyRow(${n})">This is me</button></p>`;
  }).join("");
}

function useMyRow(n) {
  document.getElementById("mapMy").value = n;
}

// Read the three rows the student chose and show the usual results preview
function readManual() {
  const sheet = mapper.sheets[mapper.sheetIndex];
  const toIndex = function (id) {
    const text = document.getElementById(id).value.trim();
    return text === "" ? null : Number(text) - 1 - sheet.rowOffset;
  };
  const valid = i => i !== null && Number.isInteger(i) && i >= 0 && i < sheet.rows.length;
  const h = toIndex("mapHeader");
  const u = toIndex("mapUnits");
  const m = toIndex("mapMy");

  if (!valid(h)) { alert("Type the row number of the course names."); return; }
  if (!valid(m)) { alert("Type the row number of your results."); return; }
  if (u !== null && !valid(u)) { alert("That credit-units row number isn't in the sheet. Leave it empty if there isn't one."); return; }
  if (h === m) { alert("The course-names row and your row can't be the same row."); return; }

  const headerItems = itemsFromHeaderRow(sheet.rows[h]);
  const items = readScores(headerItems, sheet.rows[m], u !== null ? sheet.rows[u] : null);
  if (items.length === 0) {
    alert("I couldn't find any scores in that row. Check the row numbers.");
    return;
  }

  // Untick columns that are clearly not courses (TOTAL, GPA, S/N...), unless they have a course code
  items.forEach(function (item) {
    const source = headerItems.find(h2 => matchKey(h2.code) === item.key);
    const hasCode = source && source.hasCode;
    item.include = hasCode || !NOT_A_COURSE.test(item.code + " " + item.title);
  });

  const name = String(sheet.name).trim();
  const block = { sheetName: name, items: items, target: -1, newName: name, include: true, note: "Read from the rows you chose." };
  chooseTarget(block);
  pendingUpload = { kind: "results", blocks: [block] };
  showResultsPreview(document.getElementById("uploadPreview"));
}


// ---------- 9c. AI reading (last resort) ----------
// Only offered when nothing else can read the file. The student brings their own free
// Google (Gemini) key. It is saved in this browser only and never goes into the code.

const AI_BASE = "https://generativelanguage.googleapis.com/v1beta";

function mimeFor(name) {
  const n = String(name).toLowerCase();
  if (n.endsWith(".pdf")) return "application/pdf";
  if (/\.jpe?g$/.test(n)) return "image/jpeg";
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".webp")) return "image/webp";
  return "";
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

// Model names change often, so ask Google what is available.
// Models are ranked best first: newest plain "flash", then older ones, then "flash-lite".
// Several are kept because one model can be overloaded while another is fine.
function rankModels(models) {
  const names = (models || [])
    .filter(m => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes("generateContent"))
    .map(m => String(m.name).replace(/^models\//, ""));
  const version = n => parseFloat((n.match(/gemini-(\d+(?:\.\d+)?)/) || [0, 0])[1]);
  const newestFirst = (a, b) => version(b) - version(a);
  const plain = names.filter(n => /^gemini-\d+(\.\d+)?-flash$/.test(n)).sort(newestFirst);
  const lite = names.filter(n => /^gemini-\d+(\.\d+)?-flash-lite$/.test(n)).sort(newestFirst);
  const loose = names.filter(n => /flash/.test(n) && !/image|tts|live|audio|embed|thinking|exp|preview/.test(n) &&
                                  !plain.includes(n) && !lite.includes(n)).sort(newestFirst);
  return [...plain, ...lite, ...loose];
}

function pickModel(models) {
  return rankModels(models)[0] || "";
}

async function getAiModels(key) {
  try {
    const saved = JSON.parse(localStorage.getItem("aiModels") || "null");
    if (Array.isArray(saved) && saved.length) return saved;
  } catch (e) { /* fetch a fresh list below */ }

  let list = [];
  try {
    const res = await fetch(AI_BASE + "/models?pageSize=200", { headers: { "x-goog-api-key": key } });
    if (res.ok) list = rankModels((await res.json()).models);
  } catch (e) { /* use the fallback below */ }
  if (list.length === 0) list = ["gemini-2.5-flash", "gemini-2.5-flash-lite"];
  localStorage.setItem("aiModels", JSON.stringify(list));
  return list;
}

// Waits between attempts (a setting so tests can run fast)
let AI_PAUSE_MS = 1500;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

// What Google said, in a few words (never contains your key)
function aiDetail(body) {
  let text = String(body || "");
  try { text = JSON.parse(text).error.message || text; } catch (e) { /* keep the raw text */ }
  return text.replace(/\s+/g, " ").trim().slice(0, 160);
}

function aiErrorMessage(status, body) {
  if ((status === 400 || status === 401 || status === 403) && /api key|permission|credential|forbidden/i.test(body)) {
    return "Google did not accept this key. Check that you copied all of it, or create a new one.";
  }
  if (status === 400) return "Google could not process this file. It may be too big or the wrong type. Try a smaller or clearer copy.";
  if (status === 429) return "The free limit has been reached for now. Wait a few minutes (or until tomorrow) and try again.";
  if (status >= 500) return "Google's service is busy right now. Wait a minute or two and try again.";
  return "Google sent back an error (" + status + "). Try again later.";
}

// Errors where trying another model, or trying again, can help
const AI_RETRYABLE = [404, 429, 500, 502, 503, 504];

// Send the file and instructions to Gemini and return its text answer.
// If one model is overloaded or unavailable, the next one is tried.
async function askGemini(key, parts, refreshed) {
  const models = (await getAiModels(key)).slice(0, 4);
  let last = null;

  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    let res;
    try {
      res = await fetch(AI_BASE + "/models/" + model + ":generateContent", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ parts: parts }],
          generationConfig: { temperature: 0, responseMimeType: "application/json" }
        })
      });
    } catch (e) {
      throw new Error("I couldn't reach Google. Check your internet connection and try again.");
    }

    if (res.ok) {
      const data = await res.json();
      const text = ((((data.candidates || [])[0] || {}).content || {}).parts || []).map(p => p.text || "").join("");
      if (text.trim()) {
        if (i > 0) {                                   // remember the model that worked
          const all = await getAiModels(key);
          localStorage.setItem("aiModels", JSON.stringify([model, ...all.filter(m => m !== model)]));
        }
        return text;
      }
      last = { status: 200, body: "empty answer", model: model };
    } else {
      const body = await res.text().catch(() => "");
      last = { status: res.status, body: body, model: model };
      if (!AI_RETRYABLE.includes(res.status)) throw new Error(aiErrorMessage(res.status, body));
    }
    if (i < models.length - 1) await pause(AI_PAUSE_MS);
  }

  // Every model failed. If they were all "not found", the saved list is old: get a fresh one once.
  if (last.status === 404 && !refreshed) {
    localStorage.removeItem("aiModels");
    return askGemini(key, parts, true);
  }
  if (last.status === 200) {
    throw new Error("The AI sent back an empty answer. Try again, or use a clearer copy of the file.");
  }
  throw new Error(aiErrorMessage(last.status, last.body) +
    " (I tried " + models.length + " model" + (models.length === 1 ? "" : "s") +
    ". Last answer: " + last.status + " from " + last.model + ": " + aiDetail(last.body) + ")");
}

// The AI is asked for JSON only, but strip ``` fences if it adds them
function parseAiJson(text) {
  const cleaned = String(text).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    throw new Error("I couldn't understand the AI's answer. Try again, or use a clearer copy of the file.");
  }
}

function slipPrompt() {
  return "This is a university course registration slip or course list. Extract every course. " +
    "Return ONLY JSON shaped exactly like this: " +
    '{"level":"200","session":"2025/2026","totalCredits":51,"semesters":[{"number":1,"courses":[{"code":"ANA201P","title":"Basic Anatomy","units":2}]}]}. ' +
    "Copy codes and titles exactly as printed. units is the credit unit number. " +
    "If there are no semester headings, put all courses in semester 1. Use null for anything you cannot read. Do not invent courses.";
}

function resultsPrompt(id) {
  return "This is a student's results (a screenshot, photo, PDF or table). The student's ID is: " + (id || "unknown") + ". " +
    "Extract ONLY that student's own results. If many students are listed and you cannot find that ID, return an empty list. " +
    "Return ONLY JSON shaped exactly like this: " +
    '{"found":true,"courses":[{"code":"ANA 201","title":"Basic Anatomy","units":2,"score":71}]}. ' +
    "score is the numeric total score out of 100, not the letter grade. Use null for units if they are not shown. " +
    "Never include any other student's information.";
}

function slipFromAi(obj) {
  const semestersOut = (Array.isArray(obj.semesters) ? obj.semesters : []).map(function (s, i) {
    const courses = (Array.isArray(s.courses) ? s.courses : []).map(function (c) {
      const raw = String(c.code || "").replace(/\s+/g, "").toUpperCase();
      return {
        code: SLIP_CODE.test(raw) ? formatCode(raw) : String(c.code || "").trim(),
        title: String(c.title || "").trim(),
        units: Number(c.units),
        score: null,
        test: null
      };
    }).filter(c => c.code !== "" && c.units > 0 && c.units <= 12);
    return { number: Number(s.number) || i + 1, courses: courses };
  }).filter(s => s.courses.length > 0);

  return {
    level: String(obj.level || "").replace(/\D/g, "").slice(0, 3),
    session: String(obj.session || ""),
    matric: "",                                      // never save an ID the AI may have misread
    totalCredits: Number(obj.totalCredits) || 0,
    semesters: semestersOut
  };
}

function itemsFromAi(obj) {
  const items = [];
  (Array.isArray(obj.courses) ? obj.courses : []).forEach(function (c) {
    if (c.score === null || c.score === undefined || c.score === "") return;
    const score = Number(c.score);
    const code = String(c.code || "").trim();
    if (!(score >= 0 && score <= 100) || code === "") return;
    const key = matchKey(code);
    if (items.some(x => x.key === key)) return;
    const units = Number(c.units);
    items.push({
      code: code,
      key: key,
      title: String(c.title || "").trim(),
      units: units >= 1 && units <= 9 ? units : 0,
      score: score,
      include: true
    });
  });
  return items;
}

// --- the screens ---

function startAi() {
  const box = document.getElementById("uploadPreview");
  if (!lastFile) {
    box.innerHTML = "<p>Please choose your file first.</p>";
    return;
  }
  const hasKey = !!localStorage.getItem("aiKey");

  const keyPart = hasKey
    ? `<p>\u2705 A key is saved on this device. <button class="danger" onclick="removeAiKey()">Remove my key</button></p>`
    : `<p><b>Get a free key (one time):</b></p>
       <ol>
         <li>Open <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener">Google AI Studio</a> and sign in with your Google account.</li>
         <li>Click <b>Create API key</b>, then copy it.</li>
         <li>Paste it here: <input type="password" id="aiKeyInput" autocomplete="off" placeholder="Paste your key">
             <button onclick="saveAiKey()">Save key</button></li>
       </ol>
       <p><small>The key is saved only in this browser. It is never uploaded anywhere except to Google when you use AI reading. Do not share it.</small></p>`;

  box.innerHTML = `
    <h3>AI reading (last resort)</h3>
    <p>This sends <b>"${esc(lastFile.name)}"</b> to Google's AI to read it. It can make mistakes, so you will check everything before it is saved.</p>
    ${keyPart}
    <p>What is this file?<br>
      <label><input type="radio" name="aiKind" id="aiKindSlip" checked> A course registration slip or course list</label><br>
      <label><input type="radio" name="aiKind" id="aiKindResults"> My results</label></p>
    <p><label><input type="checkbox" id="aiConsent"> I understand this file will be sent to Google. On the free plan Google may use it to improve its products.
       It does not contain other people's names or numbers (crop it to my own row first if it does).</label></p>
    <button onclick="runAi()">Read this file with AI</button>
    <p id="aiStatus"></p>`;
}

function saveAiKey() {
  const value = document.getElementById("aiKeyInput").value.trim();
  if (value.length < 20) {
    alert("That doesn't look like a full key. Copy the whole key from Google AI Studio.");
    return;
  }
  localStorage.setItem("aiKey", value);
  startAi();
}

function removeAiKey() {
  localStorage.removeItem("aiKey");
  localStorage.removeItem("aiModels");
  startAi();
}

async function runAi() {
  const status = document.getElementById("aiStatus");
  const key = localStorage.getItem("aiKey") || "";

  if (!lastFile) { status.textContent = "Please choose the file again first."; return; }
  if (!key) { status.textContent = "Please save your key first."; return; }
  if (!document.getElementById("aiConsent").checked) {
    status.textContent = "Please tick the box to confirm you understand what will be sent.";
    return;
  }
  const mime = mimeFor(lastFile.name);
  if (!mime) { status.textContent = "AI reading works with PDF files and pictures (JPG, PNG, WEBP)."; return; }
  if (lastFile.size > 15 * 1024 * 1024) { status.textContent = "That file is too big (over 15 MB). Try a smaller copy."; return; }

  const isSlip = document.getElementById("aiKindSlip").checked;
  status.textContent = "Reading with AI... this can take up to a minute.";

  try {
    const data = toBase64(await lastFile.arrayBuffer());
    const prompt = isSlip ? slipPrompt() : resultsPrompt(localStorage.getItem("matric") || "");
    const answer = parseAiJson(await askGemini(key, [{ text: prompt }, { inline_data: { mime_type: mime, data: data } }]));
    const box = document.getElementById("uploadPreview");

    if (isSlip) {
      const slip = slipFromAi(answer);
      if (slip.semesters.length === 0) { status.textContent = "The AI didn't find any courses in that file."; return; }
      pendingUpload = { kind: "slip", slip: slip, note: "Read by AI. Please check every course and unit carefully before saving." };
      showSlipPreview(box);
    } else {
      const items = itemsFromAi(answer);
      if (items.length === 0) { status.textContent = "The AI didn't find any scores for you in that file."; return; }
      const block = { sheetName: "New semester", items: items, target: -1, newName: "New semester", include: true,
                      note: "Read by AI. Please check every score carefully before saving." };
      chooseTarget(block);
      pendingUpload = { kind: "results", blocks: [block] };
      showResultsPreview(box);
    }
  } catch (err) {
    status.textContent = err.message;
  }
}


// ---------- 10. Course lists (Excel / CSV) ----------

// Layout 1: a table with columns like Course Code / Title / Units
function extractCourses(rows) {
  let headerIndex = -1;
  let cols = {};

  for (let r = 0; r < rows.length; r++) {
    const cells = rows[r].map(c => String(c).toLowerCase().trim());
    const code = cells.findIndex(c => c.includes("code"));
    const units = cells.findIndex(c => c.includes("unit") || c.includes("credit"));
    if (code !== -1 && units !== -1) {
      const title = cells.findIndex(c => c.includes("title") || c.includes("name") || c.includes("description"));
      headerIndex = r;
      cols = { code: code, title: title, units: units };
      break;
    }
  }

  if (headerIndex === -1) return [];

  const courses = [];
  for (let r = headerIndex + 1; r < rows.length; r++) {
    const row = rows[r];
    const code = String(row[cols.code]).trim().toUpperCase();
    const units = Number(row[cols.units]);
    if (code === "" || !(units > 0)) continue;
    const title = cols.title === -1 ? "" : String(row[cols.title]).trim();
    courses.push({ code: code, title: title, units: units, score: null, test: null });
  }
  return courses;
}

// Layout 2: courses taken from a result sheet's header row
function coursesFromHeader(rows) {
  for (let r = 0; r < rows.length; r++) {
    const items = codeCells(rows[r]);
    if (items.length < 3) continue;
    const saved = getSavedUnits();
    const unitsRow = findUnitsRow(rows, { row: r, items: items });
    const courses = [];
    items.forEach(function (item) {
      const key = matchKey(item.code);
      if (courses.some(c => matchKey(c.code) === key)) return;
      const fromSheet = unitsRow ? Number(unitsRow[item.col]) : 0;
      const units = (fromSheet >= 1 && fromSheet <= 9 ? fromSheet : 0) || saved[key] || 0;
      courses.push({ code: item.code, title: item.title, units: units, score: null, test: null });
    });
    return courses;
  }
  return [];
}

function showCoursesPreview(box) {
  const up = pendingUpload;
  const rows = up.courses.map((c, idx) => `
    <tr>
      <td><input type="checkbox" id="courseInclude-${idx}" checked></td>
      <td>${esc(c.code)}</td>
      <td>${esc(c.title)}</td>
      <td><input class="small" type="number" id="courseUnits-${idx}" value="${c.units || ""}" placeholder="?"></td>
    </tr>`).join("");

  const blanks = up.courses.filter(c => !c.units).length;
  const options = semesters.map((s, i) =>
    `<option value="${i}" ${up.target === i ? "selected" : ""}>${esc(s.name)}</option>`).join("") +
    `<option value="-1" ${up.target === -1 ? "selected" : ""}>+ Create a new semester</option>`;

  box.innerHTML = `
    <p>Found ${up.courses.length} courses. Untick any you didn't register.
    ${blanks ? "Fill in the blank units. The app will remember them next time." : ""}</p>
    <table><tr><th></th><th>Code</th><th>Title</th><th>Units</th></tr>${rows}</table>
    <p>Add them to: <select id="courseTarget">${options}</select>
    Name if new: <input id="courseNewName" value="${esc(up.newName)}"></p>
    <button onclick="confirmCourses()">Add these courses</button>`;
}

function confirmCourses() {
  const up = pendingUpload;
  const chosen = [];

  for (let idx = 0; idx < up.courses.length; idx++) {
    if (!document.getElementById("courseInclude-" + idx).checked) continue;
    const units = Number(document.getElementById("courseUnits-" + idx).value);
    if (!(units > 0)) {
      alert("Please fill in the units for " + up.courses[idx].code + " (or untick it).");
      return;
    }
    up.courses[idx].units = units;
    chosen.push(up.courses[idx]);
  }

  const index = Number(document.getElementById("courseTarget").value);
  let target = index >= 0 ? semesters[index] : null;
  if (!target) {
    const name = document.getElementById("courseNewName").value.trim() || "New semester";
    target = { name: name, courses: [] };
    semesters.push(target);
  }

  const saved = getSavedUnits();
  chosen.forEach(function (c) {
    saved[matchKey(c.code)] = c.units;
    if (!target.courses.some(x => matchKey(x.code) === matchKey(c.code))) target.courses.push(c);
  });
  localStorage.setItem("savedUnits", JSON.stringify(saved));
  finishUpload();
}


// ---------- 11. Start ----------
loadMatric();
applyTheme(initialTheme());
fillPresetSelect();
renderScaleEditor();
renderBandsEditor();
renderScaleSummary();
renderPreviousSummary();
requestPersistence();
render();
