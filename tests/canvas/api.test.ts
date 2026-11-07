import test from "node:test";
import assert from "node:assert/strict";
import { type CanvasFile, type CanvasModule, classifyAssignment, dayOf, htmlToText, materialTypeFor, parseNextLink, pickFiles, postedAtOnce, sequenceNumber } from "../../src/lib/canvas/api.ts";

test("assignments are exams, labs or homework by name", () => {
  assert.equal(classifyAssignment("Midterm Exam"), "exam");
  assert.equal(classifyAssignment("Quiz 3"), "exam");
  assert.equal(classifyAssignment("Final"), "exam");
  assert.equal(classifyAssignment("Lab 2: Counters"), "lab");
  assert.equal(classifyAssignment("Homework 4"), "hw");
  assert.equal(classifyAssignment("Contest entry"), "hw", "'test' inside a word isn't an exam");
});

test("material types come from the file's name and its module's", () => {
  assert.equal(materialTypeFor("ELEN3331_Syllabus.pdf"), "Syllabus");
  assert.equal(materialTypeFor("L03_Arithmetic.pdf", "Week 3"), "Lecture");
  assert.equal(materialTypeFor("hw2.pdf"), "Homework");
  assert.equal(materialTypeFor("Problem Set 1.pdf", "Assignments"), "Homework");
  assert.equal(materialTypeFor("midterm_2018.pdf", "Old exams"), "Past exam");
  assert.equal(materialTypeFor("practice_midterm.pdf"), "Practice exam");
  assert.equal(materialTypeFor("hw2_solutions.pdf"), "Practice problems");
  assert.equal(materialTypeFor("notes.pdf", "Midterm review"), "Past exam", "the module's name counts too");
});

test("dayOf takes the UTC day and refuses junk", () => {
  assert.equal(dayOf("2026-10-23T03:59:00Z"), "2026-10-23");
  assert.equal(dayOf(null), null);
  assert.equal(dayOf("soon"), null);
});

const file = (id: number, name: string, extra: Partial<CanvasFile> = {}): CanvasFile => ({ id, display_name: name, url: `https://canvas.test/files/${id}/download`, "content-type": name.endsWith(".pdf") ? "application/pdf" : "application/octet-stream", created_at: `2026-09-${String(id).padStart(2, "0")}T12:00:00Z`, ...extra });

test("pickFiles takes modules in order, then loose files, readable kinds only, once each", () => {
  const files = [file(5, "L05.pdf"), file(2, "L02.pdf"), file(3, "notes.docx"), file(9, "L01.pdf"), file(7, "hidden.pdf", { locked_for_user: true })];
  const modules: CanvasModule[] = [
    { id: 20, name: "Week 2", position: 2, items: [{ id: 1, type: "File", title: "L02.pdf", position: 1, content_id: 2 }, { id: 2, type: "Page", title: "Reading", position: 2 }] },
    { id: 10, name: "Week 1", position: 1, unlock_at: "2026-09-08T04:00:00Z", items: [{ id: 3, type: "File", title: "L01.pdf", position: 1, content_id: 9 }, { id: 4, type: "File", title: "Slides.pptx", position: 2, content_id: 42 }] },
  ];
  const picked = pickFiles(modules, files);
  assert.deepEqual(
    picked.map((p) => [p.id, p.name, p.module, p.assigned, p.file !== null]),
    [
      [9, "L01.pdf", "Week 1", "2026-09-08", true],
      [42, "Slides.pptx", "Week 1", "2026-09-08", false],
      [2, "L02.pdf", "Week 2", "2026-09-02", true],
      [5, "L05.pdf", null, "2026-09-05", true],
    ],
  );
  assert.equal(picked.every((p) => p.type === "Lecture"), true);
});

test("the Link header's next page is found, with or without quotes, and absent on the last page", () => {
  assert.equal(parseNextLink('<https://c.test/api/v1/courses?page=2&per_page=100>; rel="next",<https://c.test/api/v1/courses?page=1>; rel="first"'), "https://c.test/api/v1/courses?page=2&per_page=100");
  assert.equal(parseNextLink("<https://c.test/x?page=3>; rel=next"), "https://c.test/x?page=3");
  assert.equal(parseNextLink('<https://c.test/x?page=1>; rel="first",<https://c.test/x?page=1>; rel="last"'), null);
  assert.equal(parseNextLink(null), null);
});

test("a syllabus's HTML becomes readable text", () => {
  assert.equal(htmlToText("<h2>Grading</h2><p>Midterm &amp; final: 30% each.</p><script>x()</script><ul><li>HW 40%</li></ul>"), "Grading\nMidterm & final: 30% each.\nHW 40%");
});

test("files posted all at once (three or more within three days) are a dump; files posted over weeks are not", () => {
  const dump = pickFiles([], [file(1, "L01.pdf", { created_at: "2026-09-01T10:00:00Z" }), file(2, "L02.pdf", { created_at: "2026-09-01T10:05:00Z" }), file(3, "L03.pdf", { created_at: "2026-09-03T09:00:00Z" })]);
  assert.equal(postedAtOnce(dump), true);
  const weekly = pickFiles([], [file(1, "L01.pdf"), file(8, "L02.pdf"), file(15, "L03.pdf")]);
  assert.equal(postedAtOnce(weekly), false, "a week apart");
  assert.equal(postedAtOnce(dump.slice(0, 2)), false, "two files say nothing");
  const unknown = pickFiles([{ id: 1, name: "W1", items: [{ id: 1, type: "File", title: "a.pdf", content_id: 91 }, { id: 2, type: "File", title: "b.pdf", content_id: 92 }, { id: 3, type: "File", title: "c.pdf", content_id: 93 }] }], []);
  assert.equal(postedAtOnce(unknown), false, "no dates, no claim");
});

test("loose files go by the number in their name, then by posting date; unnumbered ones after, by date", () => {
  for (const [name, n] of [["L03_Counters.pdf", 3], ["Lecture 12 - FSMs.pdf", 12], ["lec07.pptx", 7], ["Week 2 slides.pdf", 2], ["03-karnaugh.pdf", 3], ["Ch5_Memory.pdf", 5], ["Syllabus.pdf", null], ["HW3_solutions.pdf", null], ["ELEN3331_midterm.pdf", null], ["L1.pdf", 1]] as const) {
    assert.equal(sequenceNumber(name), n, name);
  }
  // Posted out of order: L05 first, L04 a week later, a re-posted L01 last; the syllabus has no number.
  const picked = pickFiles([], [file(5, "L05.pdf", { created_at: "2026-09-01T12:00:00Z" }), file(4, "L04.pdf", { created_at: "2026-09-08T12:00:00Z" }), file(1, "Syllabus.pdf", { created_at: "2026-08-20T12:00:00Z" }), file(9, "L01.pdf", { created_at: "2026-09-15T12:00:00Z" })]);
  assert.deepEqual(picked.map((p) => p.name), ["L01.pdf", "L04.pdf", "L05.pdf", "Syllabus.pdf"]);
});
