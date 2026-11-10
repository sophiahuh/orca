/**
 * The onboarding tips (owner, 2026-11-10): what the orca points out to a new student, and when.
 * There is no fixed tour. A tip belongs to a page (`route`) and to an element on it (`target`, a CSS
 * selector); it shows the first time that element is on screen, in the order listed here. Pure.
 */

/** What a tip's conditions can read about the student. */
export interface TipContext {
  pathname: string;
  /** How many courses they have. */
  courses: number;
  /** How many sessions they have finished. */
  sessions: number;
}

export interface Tip {
  id: string;
  /** The pages it can show on, tested against the pathname. */
  route: RegExp;
  /** The element it points at; the tip waits until one is visible. */
  target: string;
  title: string;
  /** The orca speaking, first person. */
  body: string;
  /** A condition on the student's data. */
  when?: (ctx: TipContext) => boolean;
  /** Shows only after this tip: once it was seen, or later in the same run of tips. */
  after?: string;
}

const ANY = /^\//;
const MAP = /^\/$/;
const NEW_COURSE = /^\/new-course$/;
const COURSE = /^\/course\/[^/]+$/;
const COURSE_SETTINGS = /^\/course\/[^/]+\/settings$/;
const ADD_MATERIAL = /^\/add-material$/;
const REVIEW = /^\/course\/[^/]+\/review$/;
const ATLAS = /^\/course\/[^/]+\/atlas$/;
const COURSE_OR_ATLAS = /^\/course\/[^/]+(\/atlas)?$/;
const SESSION = /^\/session\/[^/]+$/;
const SETTINGS = /^\/settings$/;
/** The pages with the sidebar: the map and a course's trail. */
const WITH_SIDEBAR = /^\/(course\/[^/]+)?$/;

/** The later features wait until the student has finished one session. */
const settledIn = (ctx: TipContext) => ctx.sessions >= 1;

export const TIPS: readonly Tip[] = [
  /* ── Getting a course in ── */
  { id: "add-course", route: MAP, target: '[data-part="add-course"]', when: (c) => c.courses === 0, title: "Start with a class", body: "Hi, I'm Orca. Every class you take becomes an island here. Add your first one." },
  { id: "canvas-import", route: NEW_COURSE, target: '[data-part="import-from-canvas"]', title: "On CourseWorks?", body: "Connect Canvas and I'll bring in the class's files and due dates, so you don't upload them one by one." },
  { id: "island", route: MAP, target: '[data-part="island-spot"]', when: (c) => c.courses >= 1, title: "Your island", body: "This is your class. It starts bare and grows greener as you master your weak spots. Open it." },
  { id: "course-settings", route: COURSE, target: '[data-part="course-settings-link"]', title: "Tell me about this class", body: "Open this class's settings and tell me how its exams work. I read your notes every time I write topics and questions." },
  { id: "notes-for-orca", route: COURSE_SETTINGS, target: '[data-part="notes-for-orca"]', title: "Notes for Orca", body: "What kinds of questions does your teacher ask on exams? What does the class stress, and what can I skip? Write it here before you upload, and I'll shape your topics and questions around it." },
  { id: "uncharted-add", route: COURSE, target: '[data-part="uncharted-add"]', title: "Add your material", body: "Give me your lecture slides, notes, homework or past exams. I'll map the class into topics." },
  { id: "drop-files", route: ADD_MATERIAL, target: '[data-part="drop-target"]', title: "Drop your files here", body: "Several files or a whole folder at once is fine. Reading takes a few minutes, so you can leave this page. I'll tell you when it's done." },
  { id: "handwritten", route: ADD_MATERIAL, target: '[data-part="material-type"][data-type="Handwritten notes"]', title: "Mark what confused you", body: "If you star or circle what lost you in your notes, I can make those your weak spots. Tell me how you mark things in Settings." },

  /* ── After the first upload ── */
  { id: "upload-toast", route: ANY, target: '[data-part="upload-toast"]', title: "Your upload is ready", body: "Click this to open it and tell me which slides were hard." },
  { id: "hard-slides", route: REVIEW, target: '[data-part="hard-slides"]', title: "Which slides were hard?", body: "Tap the slides that lost you. Those become your weak spots, and weak spots are what I bring back for review." },
  { id: "reject", route: REVIEW, target: '[data-part="new-topic"]', title: "Not relevant? Reject it", body: "These are the topics I found. Reject a topic, or a single objective, if it isn't really part of the class, and I'll stop asking about it." },

  /* ── The course page ── */
  { id: "weak-count", route: COURSE, target: '[data-part="weak-count"]', title: "Your path", body: "The path shows your weak spots: topics where you flagged or missed something. Master them and this count goes up. \"Show all topics\" brings back the rest." },
  { id: "atlas-switch", route: COURSE, target: '[data-part="atlas-switch"]', after: "weak-count", title: "The Atlas", body: "The Atlas shows how the concepts in this class connect to each other." },
  { id: "edit-exams", route: COURSE, target: '[data-part="edit-exams"]', after: "weak-count", title: "Add your exams", body: "Tell me when your exams are and what they cover. I'll plan review for the week before and put them on your calendar." },
  { id: "flag-topic", route: COURSE_OR_ATLAS, target: '[data-part="dive-start"]', title: "Dive, or flag it", body: "Start a dive for harder questions on this topic. If the whole topic is shaky, flag it below and it joins your weak spots." },
  { id: "atlas-edges", route: ATLAS, target: '[data-part="topic"]', title: "How topics connect", body: "Each circle is a topic, bigger when more topics build on it. Hover a line between two to see how they're related." },

  /* ── In a session ── */
  { id: "dont-know", route: SESSION, target: '[data-part="dont-know"]', title: "Not sure?", body: "Don't guess. \"Don't know\" shows you the solution and makes this a weak spot, so I bring it back." },
  { id: "thumbs-down", route: SESSION, target: '[aria-label="Flag as a bad question"]', title: "Bad question?", body: "A thumbs down swaps it for another and tells me what was wrong, so I write better ones." },

  /* ── Reviews ── */
  { id: "quick-review", route: WITH_SIDEBAR, target: 'aside [data-todo="quick"]', title: "Your quick review", body: "A few minutes on the weak spots that are due. I space them out so they stick, on the days you set for the class." },
  { id: "dive", route: COURSE, target: '[data-part="start-deep"]', after: "quick-review", title: "Dive in", body: "For when you have more time: a longer session of harder questions, written fresh when you start." },

  /* ── Later: Settings ── */
  { id: "more-settings", route: WITH_SIDEBAR, target: '[data-part="avatar-settings"]', when: settledIn, title: "There's more in Settings", body: "Connect Canvas or Claude, tell me how you mark your notes, and set question preferences for every class." },
  { id: "settings-notes", route: SETTINGS, target: '[data-part="notes-for-orca"]', when: settledIn, title: "For all your classes", body: "Preferences here apply to every class, like the kinds of questions you want. A class's own notes win when they disagree." },
  { id: "settings-markers", route: SETTINGS, target: '[data-part="marker-notes"]', when: settledIn, title: "Your marks", body: "Tell me how you mark confusion in handwritten notes, like a star or a question mark, and I'll flag those passages as weak spots." },
  { id: "settings-canvas", route: SETTINGS, target: '[data-part="canvas-connection"]', when: settledIn, title: "Canvas", body: "Connect once, then import a class's files and assignment dates instead of uploading them." },
  { id: "settings-claude", route: SETTINGS, target: '[data-part="claude-connector"]', when: settledIn, title: "Study with Claude", body: "Connect Claude and it can quiz you with my questions in a chat. I grade your answers and keep score." },
];

/**
 * The unseen tips this page can show now, in order: on the page (`route`), their condition met,
 * their target present, and anything they wait for seen or earlier in this same list.
 */
export function eligibleTips(ctx: TipContext, seen: ReadonlySet<string>, present: (selector: string) => boolean, tips: readonly Tip[] = TIPS): Tip[] {
  const out: Tip[] = [];
  const done = new Set(seen);
  for (const tip of tips) {
    if (seen.has(tip.id) || !tip.route.test(ctx.pathname)) continue;
    if (tip.when && !tip.when(ctx)) continue;
    if (tip.after && !done.has(tip.after)) continue;
    if (!present(tip.target)) continue;
    out.push(tip);
    done.add(tip.id);
  }
  return out;
}
