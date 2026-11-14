// missions.js – the Cosmic Missions database: PRACTICAL missions that teach the platform by using it (pure: no DOM, no network).
//
// A mission is started from Learn Mode; it opens Science Mode (index.html) with ?mission=<id>, where missionRunner.js shows the steps one by one
// and ticks each step itself when the learner really does it. Step checks:
//   { on: "<css selector>" }   the learner clicks / changes / slides a control matching the selector
//   { see: "<css selector>" }  an element matching the selector is on the page and visible (e.g. a result appeared)
// `start` is where the mission opens: { query, hash }. Without a backend the field is the synthetic demo (the page labels it).
// Physics in `successFeedback` is textbook material written from memory (docs/SCIENTIFIC_LIMITATIONS.md), not a measurement.

export const MISSIONS_VERSION = "missions-2";

export const BARNARD = "ra=269.4462&dec=4.769&fov=5&det=D2";   // the Barnard's Star field of docs/VALIDATION.md

export const CATEGORIES = Object.freeze({
  basics: "Cockpit training: the workspace",
  blink: "Blink method / moving asteroids",
  proper: "Proper motion / fast stars",
  parallax: "Parallax & distance in AU",
  infrared: "Deep infrared / Planet X simulations",
  sky: "Sky maps & catalogues",
  data: "Data, tables & sharing",
  pro: "Pro lab: report what you find",
});

const on = (does, sel) => ({ does, check: { on: sel } });
const see = (does, sel) => ({ does, check: { see: sel } });
/** A measurement step: the learner reads a value off the page and types it; it is compared with the selected candidate's own number.
 *  field: a candidate property (speedArcsecPerYear, positionAngleDeg, nDet, compass) or "count" (how many candidates the search listed). */
const measure = (does, field, { unit = "", tol = 0, hint = "" } = {}) => ({ does, check: { measure: { field, unit, tol, hint } } });
const FIND = on("Press Find movers (under the picture).", "#find-movers-btn");
const LIST = see("Wait until the candidate list appears.", "#mover-list .mover-item");
const PICK = on("Click the first candidate in the list.", "#mover-list .mover-item");
const PLAY = on("Press Play under the picture.", "#play-btn");
const PX = on("Press Planet X (simulated) in the left panel.", "#planetx-demo-btn");
const DISTANT = on("Press Look for a distant body.", "#find-distant-btn");

const SPEED = measure("Read the candidate's speed in its description and type it.", "speedArcsecPerYear", { unit: "″/yr", tol: 0.05, hint: "It is the first number after the candidate's label, e.g. “#1: 10.3″/yr”." });
const PA = measure("Read its position angle (the direction, in degrees) and type it.", "positionAngleDeg", { unit: "°", tol: 2, hint: "Look for “position angle …°” in the description." });
const COMPASS = measure("Which way is it moving? Type the compass point (N, NE, E, SE, S, SW, W, NW).", "compass", { hint: "The description says “toward …”." });
const NDET = measure("In how many images was it seen? Type the number.", "nDet", { hint: "Look for “seen in … of … images”." });
const COUNT = measure("How many candidates did the search list? Count them and type the number.", "count", { hint: "Count the items in the list under the picture." });

const B = { query: BARNARD };
const at = (hash) => ({ query: BARNARD, hash });

// Missions whose tools work only on real SPHEREx data served by the backend (?data=api): on the synthetic demo the tool explains why it cannot run.
export const REAL_ONLY = new Set(["basics-flags", "blink-asteroid-check", "sky-catalogue-layer", "sky-irsa", "sky-footprints", "px-injection", "px-injection-map"]);

const M = (id, category, tier, title, story, start, steps, successFeedback) => ({
  id, category, tier, title, story, needsReal: REAL_ONLY.has(id),
  targetType: start.hash ? `workspace panel ${start.hash}` : "preset coordinates (Barnard's Star field)",
  start, objective: steps.map((s) => s.does).join(" "), steps, successFeedback,
});

export const missionsDatabase = Object.freeze([
  // ===================== Cockpit training
  M("basics-load-field", CATEGORIES.basics, 1, "Point the Telescope", "Every observation starts with a place in the sky: two numbers, RA and Dec, like longitude and latitude for stars.", B,
    [on("Click the RA box in the left panel.", "#ra-input"), on("Click the Dec box.", "#dec-input"), on("Press Load to fetch the images.", "#load-btn")],
    "RA (right ascension) and Dec (declination) are the sky's coordinates. Loading a field asks for every image of that patch of sky, taken on different dates."),
  M("basics-detector", CATEGORIES.basics, 1, "Choose Your Eye", "SPHEREx has six detectors, each seeing a different band of infrared light.", B,
    [on("Pick another detector (D1 to D6).", "#det-select"), on("Press Load.", "#load-btn")],
    "D1 sees the shortest infrared wavelengths, D6 the longest. Cool objects like brown dwarfs are brighter in the long-wavelength detectors."),
  M("basics-zoom", CATEGORIES.basics, 1, "Magnifying Glass", "Faint things hide in tiny pixels. Learn to zoom like an astronomer.", B,
    [on("Press + to zoom in.", "#zoom-in-btn"), on("Press − to zoom out.", "#zoom-out-btn"), on("Press Fit to see the whole image.", "#zoom-fit-btn")],
    "Zoom changes how big the pixels are drawn, not the data. Fit shows the whole field so you never get lost."),
  M("basics-frames", CATEGORIES.basics, 1, "Time Machine", "Each image was taken on a different day. The slider is your time machine.", B,
    [on("Drag the image slider under the picture.", "#frame-slider"), on("Change the blink speed.", "#speed-input")],
    "Stepping image by image shows exactly when something changed, instead of a blur of motion."),
  M("basics-observation", CATEGORIES.basics, 1, "Pick a Date", "Jump straight to one observation from the list of dates.", B,
    [on("Choose an observation in the date menu.", "#observation-select")],
    "Each observation has a date and a wavelength. Knowing both matters: an object can change because it moved, or because the colour changed."),
  M("basics-brightness", CATEGORIES.basics, 2, "Pull Out the Faint Ones", "The sky is mostly dark. Stretching the brightness reveals what hides in the noise.", B,
    [on("Move the brightness slider.", "#image-brightness"), on("Move the contrast slider.", "#image-contrast"), on("Press Reset display.", "#reset-view")],
    "Brightness and contrast only change how pixels are shown. Measurements always use the original numbers."),
  M("basics-grid", CATEGORIES.basics, 1, "Sky Graph Paper", "Navigators need a grid. So do astronomers.", B,
    [on("Turn on the coordinate grid.", "#show-grid"), on("Turn on the scale bar.", "#show-scalebar"), on("Turn on the centre crosshair.", "#centre-crosshair")],
    "The grid shows RA and Dec lines; the scale bar shows how many arcseconds a length on screen covers."),
  M("basics-flags", CATEGORIES.basics, 2, "Bad Pixel Patrol", "Detectors have flaws: hot pixels, cosmic-ray hits. The data mark them.", B,
    [on("Turn on the flagged-pixel layer.", "#show-flags"), on("Tick 'skip flagged pixels'.", "#skip-flagged")],
    "Flagged pixels are known to be unreliable. Skipping them avoids 'discovering' a cosmic-ray hit."),
  M("basics-shortcuts", CATEGORIES.basics, 1, "Pilot's Shortcuts", "Pros fly with the keyboard.", B,
    [on("Open the keyboard shortcuts list.", "#shortcuts-btn")],
    "Space plays and pauses, the arrows step through images, + and − zoom. Shortcuts make long inspections faster."),
  M("basics-tour", CATEGORIES.basics, 1, "Guided Flight", "Not sure where anything is? Take the guided tour.", B,
    [on("Start the 1-minute tour.", "#tour-btn")],
    "The tour points at each part of the workspace: loading data, the picture, the search buttons and the results."),
  M("basics-theme", CATEGORIES.basics, 1, "Night Vision", "Observatories use dim light so eyes stay used to the dark. Pick the theme that suits you.", B,
    [on("Choose another colour theme at the top.", "#theme-select")],
    "Themes change only colours. Charts keep a dark background in every theme so faint features stay visible."),

  // ===================== Blink method
  M("blink-first-look", CATEGORIES.blink, 1, "First Blink", "In 1930 Clyde Tombaugh found Pluto by flipping between photographs of the same sky. Stars stay put; anything that jumps is moving.", B,
    [on("Choose the Blink view.", '#mode-switch input[value="blink"]'), PLAY],
    "Blinking turns motion into flicker: the eye ignores what stays fixed and notices what jumps."),
  M("blink-difference", CATEGORIES.blink, 1, "Ghost Hunter", "Subtract one image from another and the stars cancel. What is left is a ghost: bright where something arrived, dark where it left.", B,
    [on("Choose the Difference view.", '#mode-switch input[value="diff"]'), on("Drag the image slider.", "#frame-slider")],
    "A difference image removes everything that did not change. A bright-dark pair is the signature of a mover; a lone spot may be noise or a cosmic ray."),
  M("blink-stack", CATEGORIES.blink, 2, "Long Exposure", "Add all the images together: faint fixed stars get brighter, movers smear out.", B,
    [on("Choose the Stack view.", '#mode-switch input[value="mean"]')],
    "Stacking averages the images: noise goes down, so faint fixed sources stand out. A mover is spread along its path."),
  M("blink-trail", CATEGORIES.blink, 2, "Leave a Trail", "What if every image left a footprint? Movers would draw lines.", B,
    [on("Choose the Trail view.", '#mode-switch input[value="max"]')],
    "Trail keeps the brightest value of each pixel over all images, so a mover draws its own path."),
  M("blink-compare", CATEGORIES.blink, 3, "Two Dates, One Question", "Pick any two dates yourself and compare them like a detective.", B,
    [on("Choose the Compare view.", '#mode-switch input[value="compare"]'), on("Pick image A.", "#cmp-a"), on("Pick image B.", "#cmp-b"), on("Choose how to combine them.", "#cmp-op")],
    "Images far apart in time make slow movers easier to see; images in the same band avoid colour changes that look like motion."),
  M("blink-find-movers", CATEGORIES.blink, 2, "Let the Machine Look", "Your eyes got tired. The computer can test every straight path across every image in seconds.", B,
    [FIND, LIST, PICK],
    "The search links dots across images into straight tracks and asks how unlikely each one is by chance. It returns candidates: leads to check."),
  M("blink-centre", CATEGORIES.blink, 2, "Lock the Crosshairs", "Found something? Put it in the middle of your view.", B,
    [FIND, LIST, PICK, on("Press Centre the picture on it.", "#mover-centre-btn")],
    "Centring zooms on the candidate's position in the image shown, so you can inspect its pixels."),
  M("blink-asteroid-check", CATEGORIES.blink, 2, "Is It Already Known?", "Thousands of asteroids cross the sky every night. Check whether yours already has a name.", B,
    [on("Make sure the known-asteroids layer is on.", "#show-asteroids"), FIND, LIST, PICK, see("Read the candidate's description.", "#mover-detail:not([hidden])")],
    "Surveys always compare with catalogues of known objects first (SkyBoT for asteroids, SIMBAD and Gaia for stars)."),
  M("blink-layers", CATEGORIES.blink, 1, "Clean Screen", "Too many marks? Choose what is drawn on the picture.", B,
    [FIND, LIST, on("Turn the 'Movers found' marks off.", "#show-candidates"), on("Turn them back on.", "#show-candidates")],
    "Layers only draw on top of the image; turning them off never deletes results."),
  M("blink-everything", CATEGORIES.blink, 3, "Census of the Field", "Not just movers: list every source in the field and sort them.", B,
    [on("Press Find everything.", "#discover-btn"), see("Wait for the list of sources.", "#discover-list > *"), on("Change how the list is sorted.", "#discover-sort")],
    "A census tells you what is normal in a field, so the unusual things stand out."),
  M("blink-everything-table", CATEGORIES.blink, 3, "From Cards to Science", "Cards are friendly; tables are how science is checked.", B,
    [on("Press Find everything.", "#discover-btn"), on("Switch to Table and plot.", "#discover-view-table"), on("Filter the list.", "#discover-filter")],
    "Tables and plots compare many sources at once and show the outliers a picture hides."),

  // ===================== Proper motion
  M("proper-barnard", CATEGORIES.proper, 2, "The Runaway Star", "Barnard's Star is the fastest-moving star across our sky. Over a few years it slides visibly against the background.", B,
    [PLAY, FIND, LIST, PICK, SPEED],
    "Proper motion is a star's sideways drift. Barnard's Star moves about 10 arcseconds a year (from memory) because it is close, about 6 light-years away."),
  M("proper-speed-trap", CATEGORIES.proper, 2, "Speed Trap", "A star is speeding through the field. You are the traffic officer: clock it.", B,
    [FIND, LIST, PICK, SPEED, NDET],
    "Speed across the sky is measured in arcseconds per year (1″ = 1/3600 of a degree). The more images a track is seen in, the more the speed can be trusted."),
  M("proper-compass", CATEGORIES.proper, 2, "Compass Reading", "Speed is half the story. A navigator also needs a heading.", B,
    [FIND, LIST, PICK, COMPASS, PA],
    "Position angle is measured from north (0°) through east (90°). On sky images east is to the LEFT when north is up: the mirror of a map, because we look up, not down."),
  M("proper-headcount", CATEGORIES.proper, 1, "Headcount", "How busy is this patch of sky? Let the search count the movers.", B,
    [FIND, LIST, COUNT],
    "The search lists only tracks that are unlikely to be chance alignments of noise. Few candidates in a field is normal: most of the sky stands still."),
  M("proper-detective", CATEGORIES.proper, 3, "Real or Glitch?", "A real star is seen again and again on its path. A glitch appears once. Gather the evidence like a detective.", B,
    [FIND, LIST, PICK, NDET, on("Turn on the track layer to see its fitted path.", "#show-track"), on("Press Follow it and watch it on every image.", "#mover-follow-btn"), PLAY],
    "Repeated detections along one straight path are the strongest evidence that a mover is real. A single bright pixel is usually a cosmic-ray hit."),
  M("proper-follow", CATEGORIES.proper, 1, "Ride Along", "Telescopes track their targets. You can too.", B,
    [FIND, LIST, PICK, on("Press Follow it.", "#mover-follow-btn"), PLAY],
    "Following keeps the mover centred while the background streams past."),
  M("proper-track", CATEGORIES.proper, 2, "Draw the Path", "A moving star leaves a predictable line across the images.", B,
    [on("Turn on the track layer.", "#show-track"), FIND, LIST, PICK],
    "The track is the fitted straight path. Dots that wander off it mean the motion is not straight, or they are not the same object."),
  M("proper-spectrum", CATEGORIES.proper, 3, "Colours of a Wanderer", "SPHEREx sees the sky in over a hundred infrared colours. A moving star carries its colour with it.", B,
    [FIND, LIST, PICK, on("Press Spectrum along its path.", "#mover-spectrum-btn")],
    "A spectrum is brightness against wavelength. Cool red dwarfs are brighter in the infrared; asteroids reflect sunlight and look different."),
  M("proper-all-detectors", CATEGORIES.proper, 3, "Six Eyes Agree", "A real star moves the same way in every detector. A glitch does not.", B,
    [on("Tick 'all detectors' next to the search buttons.", "#movers-all-det"), FIND, LIST],
    "Agreement between independent detectors is strong evidence. Something seen in only one detector deserves suspicion."),
  M("proper-explain", CATEGORIES.proper, 2, "Ask Why", "A good scientist can explain every claim with a number.", at("#assistant"),
    [FIND, LIST, PICK, on("Press Why is it a candidate?", '#assistant [data-kind="why"]'), on("Press the 'what could be wrong' button.", '#assistant [data-kind="wrong"]')],
    "Each sentence cites a measured value. Asking what could be wrong matters as much as asking why it is right."),

  // ===================== Parallax & distance
  M("parallax-demo-body", CATEGORIES.parallax, 2, "The Wobbling Wanderer", "Earth circles the Sun, so a nearby object seems to wobble once a year. Find the simulated one.", B,
    [PX, DISTANT, LIST, PICK],
    "Parallax is the apparent shift of a nearby object as Earth moves. Earth's orbit gives a baseline of 2 AU (1 AU ≈ 150 million km)."),
  M("parallax-models", CATEGORIES.parallax, 3, "Line or Wobble?", "A straight drift and a parallax wobble look alike over a few nights. The numbers tell them apart.", B,
    [PX, DISTANT, LIST, PICK, on("In the Planet X Lab, press Compare the motions.", "#lab-compare-btn")],
    "Model comparison asks which explanation fits best without overfitting. A wobble that beats a straight line is evidence, not proof."),
  M("parallax-distance", CATEGORIES.parallax, 2, "Ruler of the Stars", "Measure the swing, get the distance: the first rung of the cosmic distance ladder.", B,
    [PX, DISTANT, LIST, PICK, see("Read the distance in AU in its description.", "#mover-detail:not([hidden])")],
    "Distance in parsecs = 1 / parallax in arcseconds. Inside the Solar System the swing is large and distances are given in AU."),
  M("parallax-solar-system", CATEGORIES.parallax, 1, "Where Is Everyone?", "See where the planets are, squeezed so you can see them all.", at("#solar-system"),
    [on("Choose the Educational view.", 'input[name="ss-mode"][value="educational"]'), on("Change the date.", "#ss-date"), on("Press Play.", "#ss-play")],
    "The educational view is not to scale: real distances are so large the inner planets would vanish next to Neptune's orbit."),
  M("parallax-scale", CATEGORIES.parallax, 2, "Feel the Distance", "Switch to true scale and see how empty the Solar System is.", at("#solar-system"),
    [on("Choose the Scientific (to scale) view.", 'input[name="ss-mode"][value="true"]'), on("Change the range shown.", "#ss-range"), on("Change the speed.", "#ss-speed")],
    "Neptune is about 30 AU from the Sun. A planet at hundreds of AU would move only a few arcseconds per day."),
  M("parallax-place-body", CATEGORIES.parallax, 3, "Place a Planet", "Put a hypothetical body on the map at a distance you choose.", at("#solar-system"),
    [on("Type a name for your body.", "#ss-body"), on("Set its distance.", "#ss-distance")],
    "Farther bodies trace smaller yearly parallax loops: the wobble shrinks as distance grows."),

  // ===================== Deep infrared / Planet X
  M("px-hidden-body", CATEGORIES.infrared, 2, "The Ninth Shadow", "Some astronomers suspect a large planet far beyond Neptune: cold, dim and slow. The demo hides a simulated one.", B,
    [PX, on("Choose the Difference view.", '#mode-switch input[value="diff"]'), DISTANT, LIST],
    "This body is synthetic. A real distant planet would move a few arcseconds per day and mostly show Earth's parallax swing."),
  M("px-injection", CATEGORIES.infrared, 3, "Could We Even See It?", "Before searching, scientists ask: if it were there, would our method catch it?", at("#planet-lab"),
    [on("Choose the number of trials.", "#lab-trials"), on("Press Run the injection test.", "#lab-run-btn")],
    "Injection tests hide fake objects in the images and count how many are found. They measure the search; they never find anything."),
  M("px-injection-map", CATEGORIES.infrared, 3, "Map of Blind Spots", "Which distances and brightnesses can this search reach?", at("#planet-lab"),
    [on("Edit the list of distances.", "#lab-distances"), on("Edit the list of fluxes.", "#lab-fluxes"), on("Press Run the injection test.", "#lab-run-btn"), on("Save the map as CSV.", "#lab-csv-btn")],
    "A completeness map shows where a search is blind. 'Not found' means something only where the map says it could have been seen."),
  M("px-wavelengths", CATEGORIES.infrared, 2, "Choose Your Colours", "Every SPHEREx image has its own wavelength. Keep only the ones you care about.", B,
    [on("Set the minimum wavelength on the timeline.", "#tl-wl-min"), on("Set the maximum wavelength.", "#tl-wl-max"), on("Press Show all.", "#tl-reset")],
    "Cold objects glow mostly at long infrared wavelengths. The band you keep changes what the eye and the search use."),
  M("px-measure", CATEGORIES.infrared, 3, "Read the Light", "Brightness against wavelength: the fingerprint of an object.", B,
    [on("Choose a detector for the measurements.", "#measurement-detector"), on("Show the errors as a band.", 'input[name="measure-style"][value="band"]'), on("Export the visible measurements.", "#download-measurements")],
    "Every measurement has an error. A difference smaller than the error bars is not a real difference."),

  // ===================== Sky & catalogues
  M("sky-map", CATEGORIES.sky, 1, "Open the Atlas", "See your field inside an all-sky atlas built from other surveys.", at("#sky-explorer"),
    [on("Choose a survey.", "#survey-select"), on("Press Show sky map.", "#aladin-btn")],
    "Atlases like 2MASS, AllWISE and DSS show the same place at other wavelengths and dates."),
  M("sky-catalogue-layer", CATEGORIES.sky, 1, "Known Neighbours", "Mark the stars that catalogues already know.", B,
    [on("Turn on the catalogue layer.", "#show-catalogue")],
    "A candidate sitting on a known star is usually that star, not something new."),
  M("sky-check-mover", CATEGORIES.sky, 2, "Second Opinion", "Check a candidate in the sky map before believing it.", B,
    [FIND, LIST, PICK, on("Press Check in sky map.", "#mover-map-btn")],
    "Looking at the same position in other surveys quickly tells a known star or galaxy from a new object."),
  M("sky-irsa", CATEGORIES.sky, 3, "Ask the Archive", "Search NASA's IRSA archive for every SPHEREx image of a place.", at("#sky-explorer"),
    [on("Press Use the field on screen.", "#survey-field-btn"), on("Choose a search radius.", "#survey-radius"), on("Press Search IRSA.", "#survey-btn")],
    "IRSA is NASA's infrared archive. How many images exist, and when, decides whether motion can be measured at all."),
  M("sky-footprints", CATEGORIES.sky, 2, "Where Has SPHEREx Looked?", "SPHEREx scans the whole sky. See which patches it covered here.", at("#sky-explorer"),
    [on("Press Read the footprints.", "#sky-refresh-btn")],
    "A footprint is the outline of one image on the sky. Overlaps from different dates make a blink possible."),

  // ===================== Data & sharing
  M("data-tables", CATEGORIES.data, 1, "No Picture Needed", "Science is also tables: for screen readers, and for anyone who checks a number.", at("#text-analysis"),
    [on("Press Build the text analysis.", "#ta-build-btn"), on("Save the images table (CSV).", "#ta-frames-csv")],
    "Every CSV first says whether the data are real or synthetic. Labelling data honestly is this project's first rule."),
  M("data-candidates-csv", CATEGORIES.data, 2, "Your Candidate List", "Save what the search found to analyse it elsewhere.", B,
    [FIND, LIST, on("Press Save list (CSV).", "#export-csv-btn")],
    "The list holds position, motion, significance and the checks of each candidate, plus a link back to this view."),
  M("data-bundle", CATEGORIES.data, 3, "Prove It", "Claims need proof others can check without trusting you.", at("#text-analysis"),
    [on("Press Save the bundle (JSON).", "#bundle-btn")],
    "The bundle holds a SHA-256 hash of every image: change one pixel and the hash changes. It proves which data you used without publishing pixels."),
  M("data-share", CATEGORIES.data, 1, "Send It to a Friend", "Share exactly what you are looking at.", B,
    [on("Press Copy link.", "#copy-link-btn"), on("Press Embed code.", "#copy-embed-btn")],
    "The link holds the field, detector and view, so anyone opening it sees the same thing."),
  M("data-snapshot", CATEGORIES.data, 2, "Photo for the Logbook", "Keep a picture or a video of what you saw.", B,
    [on("Save the picture (PNG).", "#save-png-btn"), on("Press Record video.", "#record-btn")],
    "Saved pictures carry a label saying what the data are, so a synthetic image is never mistaken for an observation."),

  // ===================== Pro lab
  M("pro-pin", CATEGORIES.pro, 2, "Report to the Board", "Observers share leads so others can confirm them, like drivers reporting a hazard on the road. But only new things are worth reporting.", B,
    [FIND, LIST, PICK, see("Read why this one cannot be pinned: it is a known object.", "#pin-known-note:not([hidden])"),
     PX, DISTANT, LIST, PICK, on("This one is unexplained: press Pin & Report Object.", "#pin-report-btn")],
    "Known objects (catalogued stars, known asteroids) cannot be pinned: they are not finds. A pin records who saw something unexplained, where and when, with a SHA-256 hash, so others can check it. Until they confirm it, it is still a candidate."),
  M("pro-pin-distant", CATEGORIES.pro, 3, "Flag the Shadow", "Report the simulated distant body on the pin board.", at("#pin-board"),
    [PX, DISTANT, LIST, PICK, on("Press Pin & Report Object.", "#pin-report-btn")],
    "Pins made on demo data are marked synthetic. Honest labels make a shared board trustworthy."),
]);

/** "Why it matters": the real-astronomy reason behind each mission, shown in the briefing before the learner starts. */
export const MISSION_WHY = Object.freeze({
  "basics-load-field": "Every real search starts by choosing where to look. Astronomers write positions as RA and Dec so that anyone, anywhere, can point at exactly the same spot and check the result.",
  "basics-detector": "Different objects shine in different colours of infrared. Choosing the right detector can make a cold brown dwarf jump out or disappear, so knowing which one you are using is part of every measurement.",
  "basics-zoom": "Moving objects are often only a few pixels wide. You will zoom in to check whether a dot is a real source or a single bad pixel, and zoom out so you never lose track of where you are.",
  "basics-frames": "Motion only exists over time. Stepping through the images one by one is how you see when something appears, moves or vanishes.",
  "basics-observation": "Each image has a date and a wavelength. When a dot changes, you need to know whether time passed (motion) or only the colour changed (a different filter).",
  "basics-brightness": "Most interesting objects are faint. Stretching the display reveals them, but you must know that this changes only the picture, never the measured numbers.",
  "basics-grid": "To report a find you need its coordinates and size on the sky. The grid and scale bar turn pixels into positions and arcseconds.",
  "basics-flags": "Detectors are not perfect: cosmic rays and hot pixels make fake dots. Professionals throw these out before searching, or they 'discover' noise.",
  "basics-shortcuts": "Real surveys mean looking at hundreds of fields. Keyboard shortcuts are how astronomers inspect quickly without losing focus.",
  "basics-tour": "Knowing where every tool lives saves time later and shows you what the platform can do before you start a real search.",
  "basics-theme": "Comfort matters during long inspections. Every theme keeps the charts dark so faint features stay visible.",
  "blink-first-look": "Blinking is the method that found Pluto in 1930 and is still used to find asteroids. It is the heart of this whole platform.",
  "blink-difference": "Difference imaging is how modern surveys find supernovae, variable stars and asteroids automatically: subtract, and only change remains.",
  "blink-stack": "Stacking is the opposite of blinking: it hides motion to reveal faint fixed objects. Knowing both tells you whether something moves or just was too faint to see.",
  "blink-trail": "A trail turns a whole sequence into one picture, so you can see a mover's path at a glance and show it to someone else.",
  "blink-compare": "Choosing the two images yourself is how you test an idea: far-apart dates reveal slow movers, same-band images avoid colour tricks.",
  "blink-find-movers": "Eyes get tired and miss things; a computer tests every possible path. This is how real surveys turn millions of dots into a short list worth checking.",
  "blink-centre": "Before trusting a candidate you inspect it up close. Centring puts it in the middle so you can study its pixels.",
  "blink-asteroid-check": "Most moving dots are known asteroids. Checking catalogues first stops you from 'discovering' something already named, and proves the search works.",
  "blink-layers": "A clean picture lets you judge a candidate without the marks influencing you. Layers let you switch the help on and off.",
  "blink-everything": "A census of every source shows what is normal in the field, so the one object that behaves differently stands out.",
  "blink-everything-table": "Scientists check numbers, not only pictures. Tables and plots let you compare hundreds of sources at once.",
  "proper-barnard": "Barnard's Star is the classic fast star. If the platform measures its known speed correctly, you can trust it on unknown objects. This is called validation.",
  "proper-speed-trap": "Speed across the sky tells you how close and how fast a star is. Reading the number yourself teaches you where the platform reports its measurements.",
  "proper-compass": "Direction tells you whether stars travel together (a moving group) or whether a dot moves the way an asteroid in our Solar System would.",
  "proper-headcount": "Knowing how many candidates a search returns tells you whether the field is quiet or whether the search is picking up noise.",
  "proper-detective": "A real discovery needs evidence that survives checking. Being seen many times on one straight path is the strongest evidence a mover is real.",
  "proper-follow": "Following an object is how you check that the 'same' dot really is the same object on every image.",
  "proper-track": "The fitted track is the model of the motion. Comparing the dots to the track shows how good the measurement is.",
  "proper-spectrum": "Colour reveals what an object is: a cool star, a brown dwarf or a rock reflecting sunlight. SPHEREx's many wavelengths make this possible.",
  "proper-all-detectors": "Independent confirmation is the rule of science. A real object appears in every detector that can see it; an artefact does not.",
  "proper-explain": "A claim is only as good as the numbers behind it. Learning to ask 'why' and 'what could be wrong' is how scientists avoid fooling themselves.",
  "parallax-demo-body": "A nearby object wobbles as Earth orbits the Sun. This wobble is how astronomers would recognise a distant planet like a hypothetical Planet X.",
  "parallax-models": "Two explanations can fit the same dots. Comparing models with numbers, not opinions, is how you decide which one the data support.",
  "parallax-distance": "Parallax is the only direct way to measure distance in space. Every other distance in astronomy is built on top of it.",
  "parallax-solar-system": "To understand where a Planet X could hide, you first need a map of where everything else is.",
  "parallax-scale": "The real scale shows why distant planets are so hard to find: they are far, faint and slow.",
  "parallax-place-body": "Placing your own body shows how quickly the wobble shrinks with distance, which sets how far a search like this can reach.",
  "px-hidden-body": "This is a full practice run of a Planet X search on safe, simulated data, so you learn the method without mistaking a simulation for a discovery.",
  "px-injection": "If you find nothing, does it mean nothing is there, or that the search could not see it? Injection tests answer that, and every serious survey runs them.",
  "px-injection-map": "A completeness map is what turns 'we found nothing' into a scientific result: 'nothing brighter than X at distance Y'.",
  "px-wavelengths": "Cold objects glow at long infrared wavelengths. Choosing the band is choosing what kind of object you can find.",
  "px-measure": "Every measurement has an error. Learning to read error bars stops you from seeing differences that are only noise.",
  "sky-map": "Other surveys have photographed the same sky at other times and colours. Comparing with them is the fastest way to check a candidate.",
  "sky-catalogue-layer": "Catalogues hold billions of known stars. A candidate on top of a known star is usually that star.",
  "sky-check-mover": "A second opinion from an independent survey is how astronomers rule out known objects before announcing anything.",
  "sky-irsa": "IRSA is where NASA keeps SPHEREx data. Knowing how many images exist, and when, tells you whether motion can be measured at all.",
  "sky-footprints": "A blink needs the same patch of sky observed on different dates. Footprints show where that is possible.",
  "data-tables": "Science must be checkable by others, including people who cannot see the images. Tables make every number readable and citable.",
  "data-candidates-csv": "Saving your list lets you, or a colleague, analyse it later with other tools. Results that cannot be shared cannot be checked.",
  "data-bundle": "Reproducibility: someone else must be able to repeat exactly what you did. The bundle records the data's fingerprints and every setting.",
  "data-share": "A link that opens the exact same view is the quickest way to ask a colleague 'do you see this too?'.",
  "data-snapshot": "A labelled picture is evidence for your logbook or a report, and the label stops anyone mistaking a simulation for an observation.",
  "pro-pin": "Reporting is how science moves forward: you record who saw what, where and when, so others can confirm it, just like drivers reporting a hazard.",
  "pro-pin-distant": "Practising a report on simulated data teaches the workflow, and the synthetic label shows why honest labels matter on a shared board.",
});

/** "Why this step": the reason for a step, shown on the current step before the learner does it. */
export const STEP_WHY = Object.freeze({
  "#ra-input": "RA is the first half of the sky address of your target.",
  "#dec-input": "Dec is the second half: how far north or south of the sky's equator.",
  "#load-btn": "Nothing can be compared until the images of that place are loaded.",
  "#det-select": "Each detector sees another band of infrared, so the same object can look different.",
  "#zoom-in-btn": "Close up you can tell a real source (round, several pixels) from a single bad pixel.",
  "#zoom-out-btn": "Zooming back out keeps the context: where the object sits in the field.",
  "#zoom-fit-btn": "Fit is your reset when you are lost.",
  "#frame-slider": "Going image by image lets you see exactly when something changed.",
  "#speed-input": "The right speed makes motion obvious without being dizzying.",
  "#observation-select": "Picking a date directly lets you compare two specific moments.",
  "#image-brightness": "Faint objects hide near the background level; stretching makes them visible.",
  "#image-contrast": "Contrast separates faint sources from the noise around them.",
  "#reset-view": "Always return to a neutral display before judging brightness.",
  "#show-grid": "The grid turns pixels into sky coordinates you can report.",
  "#show-scalebar": "The scale bar tells you how large an angle a distance on screen is.",
  "#centre-crosshair": "The crosshair marks the exact centre of the field you asked for.",
  "#show-flags": "You need to see which pixels the instrument marked as unreliable.",
  "#skip-flagged": "Skipping flagged pixels stops cosmic rays from becoming fake candidates.",
  "#play-btn": "Your eye is very good at spotting things that jump between images.",
  '#mode-switch input[value="blink"]': "Blink shows the raw images in sequence: the most direct view.",
  '#mode-switch input[value="diff"]': "Subtracting images cancels what stayed the same, so only change is left.",
  '#mode-switch input[value="mean"]': "Averaging images lowers the noise so faint fixed sources appear.",
  '#mode-switch input[value="max"]': "Keeping the brightest value of each pixel draws a mover's path.",
  '#mode-switch input[value="compare"]': "Compare lets you test your own idea with two images of your choice.",
  "#cmp-a": "Image A is your 'before'.", "#cmp-b": "Image B is your 'after'.", "#cmp-op": "The operation decides how before and after are combined.",
  "#find-movers-btn": "The computer checks every straight path through the dots, faster and more fairly than the eye.",
  "#mover-list .mover-item": "Selecting a candidate shows its numbers and draws it on the picture so you can judge it.",
  "#find-distant-btn": "A distant planet does not move in a straight line: it wobbles with Earth's orbit. This search looks for that.",
  "#planetx-demo-btn": "The demo hides a simulated distant body so you can practise safely.",
  "#mover-centre-btn": "You inspect a candidate best when it is in the middle of the view.",
  "#mover-follow-btn": "Following checks that the candidate is the same object on every image.",
  "#mover-spectrum-btn": "Its colours tell you what kind of object it might be.",
  "#mover-map-btn": "Another survey's picture of the same spot is an independent check.",
  "#show-track": "The track is the motion model; the dots should lie on it.",
  "#show-asteroids": "Known asteroids must be ruled out before anything else.",
  "#show-catalogue": "Known stars and galaxies explain most dots in a field.",
  "#show-candidates": "Hiding the marks lets you judge the image without being influenced.",
  "#movers-all-det": "A real object should be found in several detectors, a glitch in only one.",
  "#discover-btn": "Measuring every source tells you what is normal in this field.",
  "#discover-sort": "Sorting brings the most interesting sources to the top.",
  "#discover-view-table": "A table shows many numbers side by side for comparison.",
  "#discover-filter": "Filtering removes what you already understand.",
  "#lab-compare-btn": "Fitting several motion models tells you which explanation the data prefer.",
  "#lab-trials": "More trials give a more reliable answer, but take longer.",
  "#lab-run-btn": "Hiding fake bodies and searching again measures what the search can really find.",
  "#lab-distances": "The distances decide how far out the test reaches.",
  "#lab-fluxes": "The fluxes decide how faint the test bodies are.",
  "#lab-csv-btn": "A saved map can go in a report or be compared with other searches.",
  "#tl-wl-min": "Removing short wavelengths focuses on cool objects.",
  "#tl-wl-max": "The upper limit closes your chosen band.",
  "#tl-reset": "Going back to all images avoids forgetting a filter is on.",
  "#measurement-detector": "Measurements are made per detector, because each sees other wavelengths.",
  'input[name="measure-style"][value="band"]': "Showing the error as a band makes it easy to see which differences are real.",
  "#download-measurements": "Exported numbers can be checked and reused by others.",
  "#survey-select": "Each survey saw the sky in other colours and at another time.",
  "#aladin-btn": "The atlas shows the same place through other telescopes.",
  "#survey-field-btn": "Searching the archive at your field's centre.",
  "#survey-radius": "The radius sets how much sky around the centre is searched.",
  "#survey-btn": "This asks NASA's archive for every SPHEREx image of the place.",
  "#sky-refresh-btn": "Footprints show which images cover this patch of sky.",
  "#ta-build-btn": "Turning the picture into tables makes every value readable and checkable.",
  "#ta-frames-csv": "The images table records each date and wavelength used.",
  "#export-csv-btn": "Your candidate list, saved, can be shared and re-analysed.",
  "#bundle-btn": "The bundle lets someone else repeat exactly what you did.",
  "#copy-link-btn": "A link reproduces your view for anyone.",
  "#copy-embed-btn": "Embed code puts this view inside another web page.",
  "#save-png-btn": "A labelled picture is evidence for your logbook.",
  "#record-btn": "A video shows the motion to people who cannot run the tool.",
  "#pin-report-btn": "Reporting records who saw what, where and when, so others can check it.",
  'input[name="ss-mode"][value="educational"]': "The squeezed view lets you see all planets at once.",
  'input[name="ss-mode"][value="true"]': "The true scale shows how far apart things really are.",
  "#ss-date": "Planets move; their positions depend on the date.",
  "#ss-play": "Playing shows the planets' motion over time.",
  "#ss-range": "The range sets how much of the Solar System is shown.",
  "#ss-speed": "The speed sets how fast time runs in the animation.",
  "#ss-body": "Naming your body makes it easy to find on the map.",
  "#ss-distance": "Its distance decides how big its parallax wobble would be.",
  "#theme-select": "Pick the colours you can look at comfortably for a long time.",
  "#shortcuts-btn": "Shortcuts make long inspections faster.",
  "#tour-btn": "The tour shows where each part of the workspace is.",
});

export const missionWhy = (m) => MISSION_WHY[m?.id] ?? "";

/** For complete beginners: what each topic is about, in plain words, and an icon. Keyed by category text. */
export const CATEGORY_INFO = Object.freeze({
  [CATEGORIES.basics]: { icon: "🛰️", intro: "Before searching the sky you need to know your instruments. These missions show you around the workspace: how to choose a place in the sky, look at its pictures, zoom, and change how they are shown. Nothing here needs any astronomy knowledge.", learn: ["Choose a place in the sky", "Read and move through the pictures", "Adjust what you see"] },
  [CATEGORIES.blink]: { icon: "✨", intro: "Telescopes photograph the same patch of sky on different days. Stars stay in the same place; things that are close to us, like asteroids, move. By flipping between the pictures you can spot what moved. These missions teach you that trick and the tools that do it for you.", learn: ["Spot a moving dot by eye", "Let the computer search for movers", "Check if a mover is already known"] },
  [CATEGORIES.proper]: { icon: "☄️", intro: "Stars look fixed, but they all travel through space. A few are close enough that their drift shows up over months or years. In these missions you measure how fast and in which direction a real fast star moves.", learn: ["Measure a star's speed across the sky", "Read its direction", "Decide if a detection is real or a glitch"] },
  [CATEGORIES.parallax]: { icon: "📐", intro: "As Earth goes around the Sun, nearby objects seem to wobble a little, once a year, the same way your thumb jumps when you look with one eye and then the other. The size of the wobble tells you the distance. These missions use that to measure how far things are.", learn: ["See Earth's yearly wobble in the data", "Turn a wobble into a distance", "Explore the Solar System to scale"] },
  [CATEGORIES.infrared]: { icon: "🔭", intro: "Some astronomers think a big, cold planet may hide far beyond Neptune: a 'Planet X'. It would be faint and glow mostly in infrared light, which our eyes cannot see. These missions let you practise the search on a safe, simulated planet.", learn: ["Search for a slow, distant body", "Test what a search can and cannot find", "Work with infrared colours"] },
  [CATEGORIES.sky]: { icon: "🗺️", intro: "Other telescopes have photographed the whole sky before. Comparing with their pictures and lists of known stars is the fastest way to check a find. These missions show you those maps and catalogues.", learn: ["Open an all-sky atlas", "Show known stars on your picture", "Ask NASA's archive what exists"] },
  [CATEGORIES.data]: { icon: "💾", intro: "Science only counts when others can check it. These missions show you how to save your results as tables, share exactly what you see, and prove which data you used.", learn: ["Save results as a table", "Share a link to your view", "Make a proof file of your data"] },
  [CATEGORIES.pro]: { icon: "📌", intro: "When you find something, you report it so others can confirm it, like reporting a hazard on a road map. These missions teach you to pin a find on the shared board with your name.", learn: ["Pin a find on the shared board", "Read a report's details", "Understand why honest labels matter"] },
});

/** A plain-language glossary for beginners. `match` finds the word in a mission's text. */
export const BEGINNER_GLOSSARY = Object.freeze([
  { term: "RA and Dec", match: /\b(RA|Dec|right ascension|declination)\b/i, simple: "The sky's address system, like longitude and latitude on Earth. RA goes around the sky (0 to 24 hours), Dec goes from the north pole (+90°) to the south pole (−90°)." },
  { term: "Detector", match: /\bdetectors?\b/i, simple: "The camera chip inside the telescope. SPHEREx has six, each seeing a different band of infrared light (D1 to D6)." },
  { term: "Infrared", match: /infrared/i, simple: "Light with longer waves than red light. Our eyes cannot see it, but warm and cold objects give it off. SPHEREx sees the sky in infrared." },
  { term: "Pixel", match: /\bpixels?\b/i, simple: "One tiny square of a digital picture. On SPHEREx one pixel covers about 6 arcseconds of sky." },
  { term: "Arcsecond (″)", match: /arcsec|″/i, simple: "A tiny angle on the sky: 1/3600 of a degree. The full Moon is about 1800 arcseconds wide." },
  { term: "Blink", match: /\bblink/i, simple: "Showing pictures of the same sky one after another, so anything that moved seems to jump." },
  { term: "Difference image", match: /difference/i, simple: "One picture minus another. Everything that stayed the same disappears; only changes are left." },
  { term: "Candidate", match: /candidate/i, simple: "Something that might be interesting, but is not confirmed yet. A clue to check, not a discovery." },
  { term: "Mover", match: /\bmovers?\b|moving/i, simple: "A dot that changes position between pictures taken on different dates." },
  { term: "Asteroid", match: /asteroid/i, simple: "A rocky body that circles the Sun, much smaller than a planet. Thousands are known; most live between Mars and Jupiter." },
  { term: "Catalogue", match: /catalogue|SIMBAD|Gaia/i, simple: "A big list of known stars and objects with their positions. Checking it tells you if something is already known." },
  { term: "Proper motion", match: /proper motion|speed|″\/yr|arcseconds per year/i, simple: "How fast a star drifts across the sky, usually in arcseconds per year." },
  { term: "Position angle", match: /position angle|compass|direction/i, simple: "The direction of motion on the sky, in degrees: 0° is north, 90° is east." },
  { term: "Parallax", match: /parallax|wobble/i, simple: "The small yearly back-and-forth shift of a nearby object caused by Earth moving around the Sun. Smaller shift = farther away." },
  { term: "AU", match: /\bAU\b/i, simple: "Astronomical Unit: the distance from Earth to the Sun, about 150 million km. Neptune is about 30 AU from the Sun." },
  { term: "Planet X", match: /planet x|distant body|ninth/i, simple: "A hypothetical large planet far beyond Neptune. Nobody has found it; this app only practises the search, on simulated data." },
  { term: "Simulated / synthetic", match: /simulat|synthetic|demo/i, simple: "Made by the computer for practice, not a real observation. The app always labels it." },
  { term: "Signal-to-noise (S/N)", match: /S\/N|noise|significan|σ/i, simple: "How clearly something stands out from random speckles in the picture. Bigger is clearer." },
  { term: "Spectrum", match: /spectrum|wavelength|colou?rs/i, simple: "How bright something is at each colour (wavelength) of light. It works like a fingerprint." },
  { term: "Ecliptic", match: /ecliptic|solar system/i, simple: "The path across the sky where the Sun and planets travel. Most asteroids are near it." },
  { term: "Injection test", match: /injection|fake objects|blind spots/i, simple: "Hiding fake objects in the pictures to see if the search finds them. It measures how good the search is." },
  { term: "Archive (IRSA)", match: /IRSA|archive/i, simple: "NASA's online library where SPHEREx pictures are stored." },
  { term: "Hash (SHA-256)", match: /hash|SHA-256|fingerprint/i, simple: "A short code computed from data. Change one bit of the data and the code changes completely, so it proves nothing was edited." },
  { term: "CSV", match: /\bCSV\b|table/i, simple: "A simple table file that spreadsheets like Excel or Google Sheets can open." },
  { term: "Field", match: /\bfield\b/i, simple: "The patch of sky you are looking at, usually a few arcminutes wide." },
]);

/** The glossary words a mission uses (for its "New words" box). */
export function termsFor(mission, max = 6) {
  const text = [mission.story, mission.objective, mission.successFeedback, MISSION_WHY[mission.id] ?? ""].join(" ");
  return BEGINNER_GLOSSARY.filter((g) => g.match.test(text)).slice(0, max);
}
export const categoryInfo = (m) => CATEGORY_INFO[m?.category] ?? { icon: "🚀", intro: "", learn: [] };
/** Why the learner does this step (before doing it). */
export function stepWhy(s) {
  if (s.why) return s.why;
  if (s.check.on) return STEP_WHY[s.check.on] ?? "";
  if (s.check.measure) return "Reading the number yourself teaches you where the platform reports its measurements; the check tells you if you read it right.";
  return "The platform is working; this step ticks itself when the result is on screen.";
}

/** "What just happened": what each control does, shown when the learner completes a step on it (a step's own `learn` wins). */
export const STEP_NOTES = Object.freeze({
  "#ra-input": "RA is measured eastward along the sky's equator, in hours (0–24h) or degrees (0–360°).",
  "#dec-input": "Dec is the angle north (+) or south (−) of the sky's equator, from −90° to +90°.",
  "#load-btn": "The app fetched every image of this field. In the demo the images are synthetic; with the real backend they come from IRSA.",
  "#det-select": "Each detector covers its own slice of infrared wavelengths, so the same star can look brighter or fainter in another one.",
  "#zoom-in-btn": "Zooming in draws each pixel bigger. One SPHEREx pixel covers about 6 arcseconds of sky.",
  "#zoom-fit-btn": "Fit puts the whole field back on screen.",
  "#frame-slider": "Each position of the slider is one image, taken on its own date.",
  "#speed-input": "Faster blinking makes jumps easier to notice; slower lets you study each image.",
  "#observation-select": "Every observation has a date and a wavelength; the timeline shows both.",
  "#image-brightness": "Only the display changed. The numbers used for measurements stay the same.",
  "#reset-view": "Display settings are back to their defaults.",
  "#show-grid": "The grid lines are lines of constant RA and Dec.",
  "#show-flags": "Flagged pixels are the ones the pipeline marked as unreliable.",
  "#play-btn": "The images now play like a flip-book. Your eye is very good at catching what jumps.",
  '#mode-switch input[value="blink"]': "Blink shows the images one after another, unchanged.",
  '#mode-switch input[value="diff"]': "Difference subtracts images: what did not change turns grey, what changed turns bright or dark.",
  '#mode-switch input[value="mean"]': "Stack averages all images: noise drops, faint fixed stars appear.",
  '#mode-switch input[value="max"]': "Trail keeps the brightest value of each pixel: movers draw their path.",
  '#mode-switch input[value="compare"]': "Compare lets you choose the two images and the operation yourself.",
  "#find-movers-btn": "The search found the dots in every image, linked them into straight tracks, and kept only tracks unlikely to be chance.",
  "#mover-list .mover-item": "Selecting a candidate rings it on the picture and draws its path; its description appears under the list.",
  "#find-distant-btn": "This search fits a slow drift plus Earth's yearly parallax swing, the motion a far planet would have.",
  "#planetx-demo-btn": "This loaded the synthetic demo with a simulated distant body hidden in it.",
  "#mover-centre-btn": "The view is now centred on the candidate.",
  "#mover-follow-btn": "The view now moves with the candidate from image to image.",
  "#mover-spectrum-btn": "The candidate was measured on each image, at its position on that date, and plotted against wavelength.",
  "#mover-map-btn": "The sky map now shows the candidate's position in other surveys.",
  "#show-track": "The track is the straight path fitted to the candidate's positions.",
  "#show-asteroids": "Known asteroids (from SkyBoT) are marked where they were on each image's date.",
  "#show-catalogue": "Known stars and galaxies (SIMBAD/Gaia) are marked on the picture.",
  "#movers-all-det": "Now the search runs on all six detectors and compares them.",
  "#discover-btn": "Find everything measured every source in the field, moving or not.",
  "#lab-compare-btn": "Three models were fitted to the positions: standing still, a straight line, and a line plus parallax.",
  "#lab-run-btn": "Synthetic bodies were added to the images and the search was run again to see how many it recovers.",
  "#aladin-btn": "The sky atlas opened at this field.",
  "#survey-btn": "The IRSA archive was asked which SPHEREx images cover this position.",
  "#ta-build-btn": "Every image, dot and candidate is now also a table you can read or save.",
  "#bundle-btn": "The bundle records the data's SHA-256 fingerprints and the search settings, so someone else can repeat it.",
  "#copy-link-btn": "The link to this exact view is on your clipboard.",
  "#pin-report-btn": "The pin dialog opened. A pin records who reported what, where and when.",
});

export const xpFor = (mission) => 50 * (mission?.tier ?? 1);
export const totalXp = (progress) => progress.completed.reduce((s, id) => s + xpFor(findMission(id)), 0);
const RANKS = [[0, "Cadet Observer"], [300, "Blink Spotter"], [800, "Track Hunter"], [1500, "Field Astronomer"], [2500, "Survey Scientist"], [4000, "Planet X Hunter"]];
export function rankFor(xp) {
  let r = RANKS[0][1];
  for (const [min, name] of RANKS) if (xp >= min) r = name;
  return r;
}

/** Check a typed measurement against the true value. truth: the candidate (or { count }) the page reports. Returns { ok, expected }. */
export function checkMeasurement(check, typed, truth) {
  const field = check.field;
  const want = field === "count" ? truth?.count : truth?.[field];
  if (want == null) return { ok: false, expected: null };
  if (typeof want === "string") return { ok: String(typed).trim().toUpperCase() === want.toUpperCase(), expected: want };
  const got = Number(String(typed).replace(",", ".").replace(/[^0-9.eE+\-]/g, ""));
  if (!Number.isFinite(got)) return { ok: false, expected: want };
  const tol = check.tol < 1 && check.tol > 0 ? Math.abs(want) * check.tol : check.tol;
  return { ok: Math.abs(got - want) <= Math.max(tol, field === "speedArcsecPerYear" ? 0.15 : 0), expected: want };
}

/** Pick a mission at random. `rng` returns [0,1) (Math.random by default); `avoidIds` are skipped when anything else is left. */
export function pickRandomMission(rng = Math.random, avoidIds = [], db = missionsDatabase, { real = false } = {}) {
  db = real ? db : db.filter((m) => !m.needsReal);
  if (!db.length) return null;
  const avoid = new Set(avoidIds);
  const pool = db.filter((m) => !avoid.has(m.id));
  const from = pool.length ? pool : db;
  return from[Math.min(from.length - 1, Math.floor(rng() * from.length))];
}

export const findMission = (id) => missionsDatabase.find((m) => m.id === id) ?? null;

/** The Science Mode URL that starts a mission. Keeps ?data=api&api=… and ?theme= from the current page. */
export function missionHref(mission, currentSearch = "") {
  const keep = new URLSearchParams(currentSearch);
  const p = new URLSearchParams();
  for (const k of ["data", "api", "theme"]) if (keep.has(k)) p.set(k, keep.get(k));
  for (const [k, v] of new URLSearchParams(mission.start?.query || BARNARD)) p.set(k, v);
  p.set("mission", mission.id);
  return `index.html?${p}${mission.start?.hash ?? ""}`;
}

/** Does an event target satisfy an { on } check? A click on a <label> counts for its control. */
export function stepMatches(check, target) {
  if (!check?.on || !target?.closest) return false;
  if (target.closest(check.on)) return true;
  const label = target.closest("label");
  return Boolean(label?.control?.matches?.(check.on));
}

const KEY = "spherex-blink-missions";

export function loadProgress(storage) {
  try {
    const p = JSON.parse(storage?.getItem(KEY) || "{}");
    const ids = new Set(missionsDatabase.map((m) => m.id));
    return { completed: [...new Set((p.completed || []).filter((id) => ids.has(id)))], recent: (p.recent || []).filter((id) => ids.has(id)).slice(-5) };
  } catch { return { completed: [], recent: [] }; }
}

export function saveProgress(storage, progress) {
  try { storage?.setItem(KEY, JSON.stringify(progress)); return true; } catch { return false; }
}

export function markComplete(progress, id) {
  return progress.completed.includes(id) ? progress : { ...progress, completed: [...progress.completed, id] };
}

export function noteShown(progress, id) {
  return { ...progress, recent: [...progress.recent.filter((r) => r !== id), id].slice(-5) };
}
