# TODO complet – SPHEREx Blink (NASA Space Apps 2026)

Stare: **6 noiembrie 2026**. Bifează cu `[x]` pe măsură ce termini.
Legendă: **[confirmat]** = văzut pe surse oficiale · **[neconfirmat]** = presupus / din ani trecuți, de verificat ·
`P0` = blocant, `P1` = obligatoriu pentru predare, `P2` = foarte util, `P3` = dacă rămâne timp.
Estimările de timp sunt ale mele, nu măsurate.

> Acest fișier înlocuiește și completează `docs/SUBMISSION.md` (acela rămâne ca scenariu pentru video și listă scurtă).

---

## 0. Calendar

| Dată | Ce se întâmplă | Status |
|---|---|---|
| 28 oct | Enunțurile complete ale provocărilor publicate | neconfirmat (listare terță) |
| 2 nov | Space Apps Connect (forumul GitHub) s-a deschis | confirmat (FAQ, via căutare) |
| **13 nov** | **Apar ghidurile: Project Submission Guide + Judging & Awards Guide** | confirmat (FAQ) |
| **14 nov, 09:00** | **Start hackathon; se deschide predarea (ora locală)** | confirmat |
| **15 nov, 23:59** | **Se închide predarea (ora locală)** | confirmat |
| 15 nov | Ultima zi de înscriere în hackathon | confirmat (căutare) |
| 30 nov | Chestionar participanți | neconfirmat (terț) |

Echipă: **maximum 6 persoane** [confirmat]. Cont GitHub necesar pentru forum.

---

## 1. BLOCANTE – de rezolvat primele (P0)

Proiectul a început pe 5 nov, înainte de hackathon. Pe site-ul oficial există un memento să nu începi lucrul la proiect înainte
de start [parțial confirmat: nu am găsit textul exact, nu știu cum se aplică unui prototip existent].

- [ ] **P0** Deschide din browserul tău https://www.spaceappschallenge.org/2026/ și https://www.spaceappschallenge.org/resources/participant-faqs/ și citește exact regula despre începerea lucrului. Salvează textul (captură) în `docs/evidence/`.
- [ ] **P0** Verifică termenii: https://www.spaceappschallenge.org/legal/ (proprietate intelectuală, licență acordată, surse citate, videoclip).
- [ ] **P0** Postează în Space Apps Connect, categoria **Project Submission Help** (text în Anexa A). Caută întâi discuții existente.
- [ ] **P0** Scrie Local Lead-ului evenimentului tău (Cluj, dacă ai ales Cluj) cu istoricul complet, fără să ascunzi nimic.
- [ ] **P0** Confirmă că ești **înregistrat** în hackathon, că ai ales evenimentul local corect și dacă ai echipă / cine e în ea.
- [x] **P0 – REGULA ANULATĂ de tine (7 nov, „anuleaza regula”):** regula „nu dezvoltăm nimic înainte de 14 nov 2026, 09:00” (pusă mai devreme în aceeași zi) a fost **anulată**; dezvoltarea în mock continuă. **Riscul de eligibilitate rămâne**: regula oficială nu e confirmată, iar proiectul a început pe 5 nov, înainte de hackathon. Păstrează **istoricul cinstit** (README, CREDITS.md) și declară folosirea AI la predare. Întrebarea către organizatori (Anexa A) rămâne utilă.
- [x] **Poza din header (7 nov):** poza dată de tine venea dintr-un **clip stock de la Getty Images** (conținut cu licență plătită, deci nu poate fi publicată). A fost **înlocuită cu o nebuloasă generată de noi** (`scratch/make_nebula.py`; nu folosește pixeli de la nimeni; culorile au fost doar eșantionate din poza de referință). Fișierele derivate din clipul Getty au fost **scoase din proiect** și sunt într-un folder de rezervă în afara repo-ului (`scratchpad/getty_derived_backup/`); **nu le publica**.
- [x] **P1** (făcut în `CREDITS.md`, 2026-11-07) În `CREDITS`: „Header and page background images: generated procedurally by the author (`scratch/make_nebula.py`); not SPHEREx data”. Dacă preferi o imagine reală NASA în loc de una generată, verifică licența pe pagina fiecărei imagini.
- [ ] **P0** (rămâne util dacă vrei să reutilizezi cod) Decide după răspuns:
  - dacă prototipul e acceptat → continui cu secțiunile 2–6;
  - dacă nu → nu depui codul existent; începi pe 14 nov (decizia și riscul sunt ale tale; întreabă organizatorii ce e permis să refolosești: idei, documentație, cunoștințe).
- [ ] **P0** Până primești răspunsul, **fă doar pregătire** (secțiunea 7), nu dezvolta soluția.

---

## 2. Cod – funcționalitate

### 2.1 Stare curentă
- [ ] **P1** Commit pentru poziția prezisă + documentație (modificările de după `23079db`). Include `docs/TODO.md`.
- [ ] **P1** Rulează toate testele (`node scratch/test_*.mjs`) înainte de fiecare commit.

### 2.2 Date reale (ultimul pas, dar cel mai important pentru „Validity”)

> **Actualizare 7 nov (noaptea, după ideile 1–9, cu descărcări):** date reale: 60 de cutout-uri, 279 MB (Barnard, Epsilon Indi B, WISE 0855 D2+D6, Arosa ×3, Makemake ×7). Făcute: (1) scara Jy verificată pe stele 2MASS/AllWISE: raport 0,97 în D2 și 0,90 în D6; (2) steagurile ca mască (`maskUrl`) + ajustare gaussiană pe pixelii nemarcați: **Barnard D2 de la 3,72 la 0,31 ″/an**, iar estimarea alarmelor false (linii întâmplătoare așteptate: ≤ 1e-4 la cei reali, ~17 la cei 3 falși); (3)+(4) legare între detectori („Use all detectors”: Barnard 21/21 imagini, 0,20 ″/an; Epsilon Indi B 17/17, 0,53) și suportul căii în fiecare imagine + avertisment de amestec cu altă sursă; (5) audit telefon/proiector ([ACCESSIBILITY.md](ACCESSIBILITY.md)) + plan de filmare în PITCH §8; (7) WISE 0855: stack pe cale 0,415 ± 0,076 mJy în D6 (4,3× scatter-ul controalelor): **sugestiv, nu detecție**; partea D2 e o stea 2MASS J = 15,4 la 7,5″; (8) Arosa **dovedit că se mișcă** (563″ în 19,5 h, absent de la poziția veche/nouă în imaginea cealaltă); (6) Makemake: ajustarea paralaxei dă **52,65 AU față de 52,62 AU** (Horizons) când știe unde să caute, dar **căutarea oarbă NU a găsit Makemake** (10 candidați la 52–54 AU, toți combinații întâmplătoare; cutout-urile sunt centrate pe corp și corpul e detectat în 4 din 7 imagini); (9) legare pe mai multe câmpuri (mozaic) funcționează pe date sintetice (4/4), nu e demonstrată pe date reale. Un bug de deduplicare găsit prin testul real (doi rivali ai unui al treilea rămâneau ambii) e reparat, cu test. **Rămas / nevalidat:** căutarea oarbă Planet X pe date reale (ar trebui cutout-uri necentrate pe corp și ≥ 6–7 detecții); un câmp nou pentru a testa independent regulile (60 %, alarmă falsă, masca); licența datelor reale; zero-point-urile 2MASS/WISE sunt scrise din memorie. Detalii: [VALIDATION.md](VALIDATION.md).

> **Actualizare 7 nov (seara, după „toate cele 5 idei"):** date reale folosite (39 de cutout-uri: Barnard D2 + D6, Epsilon Indi B D2 + D6, unul cu asteroidul Arosa; 177 MB în `backend/data/real/`, ignorat de git). **Find movers orb: regăsiți în 4 din 4 rulări** (Barnard D6 la 0,55 ″/an de catalog, Epsilon Indi B la 0,61 în D2 și 0,54 în D6; **Barnard D2 la 3,72 ″/an, cauză necunoscută**, ipoteză: nucleu saturat). **Epsilon Indi B D6 a dat întâi 3 candidați falși** (linii prin 3 din 6 imagini), de aceea regula a devenit „minimum 60 % din imagini" (`minDetectionFraction`): rularea aceea nu mai e un test independent. **Asteroid real găsit într-o imagine reală**: Arosa (V 14,6), sursă de 107 σ la 1,0″ de poziția SkyBoT, fără stea 2MASS acolo (o singură imagine: nu dovedește mișcarea). **Indiciul de culoare pe un obiect real:** Epsilon Indi B dă 0,65 = „neutral", nu „red"; nu separă o pitică M de una T timpurie. Detalii și limite: [VALIDATION.md](VALIDATION.md). Adăugat în aplicație: pixeli float + registrare, reeșantionare bilineară, fotometrie în Jy, spectru pe traiectoria unui mover cu indiciu de culoare, **mod Planet X (paralaxă; doar pe date sintetice)**, asteroizi cunoscuți (SkyBoT, fără proxy), export CSV/JSON, tur ghidat, GIF etichetat sintetic, [PITCH.md](PITCH.md). **Nefăcut / nevalidat:** modul Planet X pe date reale; dovada de mișcare a asteroidului (a doua imagine a lui Arosa, ~5 MB, nedescărcată); un câmp nou pentru a testa independent regula de 60 %; steagurile ca mască în centroid; licența datelor reale (de aceea nu sunt în repo).

> **Actualizare 7 nov:** scriptul `backend/scripts/fetch_real_sample.py` + ghidul [REAL_DATA_TEST.md](REAL_DATA_TEST.md) sunt gata (86 de teste offline). **Pasul A (doar căutare, fără descărcare) rulat: merge, iar toate cele 5 obiecte au date reale** (tabel în [IRSA_FACTS.md](IRSA_FACTS.md) §8b). **Următorul pas, la utilizator (8 nov dimineața):** `--target barnard --download 1`, apoi lipit raportul în chat. După el: adaptat `query.py`, sursa de date IRSA în backend, Find movers pe date reale.

> **Actualizare 6 nov:** documentația IRSA e publică; vezi [IRSA_FACTS.md](IRSA_FACTS.md). **Metoda de acces e cunoscută** (TAP + cutout server-side, colecții `spherex_qr2` / `spherex_qr3`). Punctele de mai jos rămân ca listă de lucru, dar **„găsește metoda de acces” și „definiția biților de flag” sunt rezolvate în documentație**; rămân de făcut implementarea și validarea pe date reale. Primul pas concret (permis ca pregătire): **rulezi tu o interogare TAP** din documentație pentru WISE 0855 și ne spui câte imagini sunt pe detector.
- [ ] **P1** Găsește un fișier SPHEREx real (documentația IRSA / tab-ul Resources al provocării / forumul). Nu ghici URL-uri.
- [ ] **P1** `inspect_fits.py` pe el → bifează `docs/DATA_CHECKLIST.md`.
- [ ] **P1** Corectează CONFIG din `backend/spherex/query.py`: HDU imagine / flag-uri, cuvinte-cheie timp / detector / lungime de undă, nume detectoare, perechi, unități.
- [ ] **P1** Aflu metoda de acces IRSA (SIA / TAP / cutout) din documentație și o implementez în `query.py` (+ cache).
- [ ] **P1** Lungimea de undă **la poziția cutout-ului** (filtru variabil liniar), nu una per fișier.
- [ ] **P1** Biții de flag care înseamnă „pixel nesigur” (acum orice bit ≠ 0).
- [ ] **P1** NaN-uri: statistici, stretch, fotometrie să nu fie contaminate.
- [ ] **P1** WCS cu distorsiuni (SIP etc.): verifică cu stele cunoscute.
- [ ] **P1** **Validare**: WISE 0855 pe tick-urile verzi în fiecare cadru, offset < 0,5 px (`scratch/check_track.js`). Offset constant = WCS/centru; crescător în timp = timp greșit; oglindit = imagine întoarsă.
- [ ] **P1** Fișiere mari (2040×2040 float32 ≈ 16,6 MB/cadru): măsoară dimensiuni reale, timp de descărcare, rate-limit; menține tăierea cutout-urilor pe server.
- [ ] **P1** Fallback clar în UI: dacă backend-ul real e indisponibil, mesaj explicit (și, dacă treci pe mock, insigna „Mock data”).
- [ ] **P2** Zgomot real: testează Difference/Trail pe imagini reale; ajustează pragul de 30 de zile după cadența reală.
- [ ] **P2** Mișcare sub-pixel (~0,7 px la 6 luni): centroid sub-pixel + vedere mărită locală.
- [ ] **P2** Păstrarea fluxului la reeșantionare (acum cel mai apropiat vecin): decide dacă fotometria se face pe pixelii originali.

### 2.3 Funcții noi (ordonate după impact / efort)
- [x] **P2** **Tur ghidat** (făcut 2026-11-07, `frontend/js/features/tour.js`, butonul „Take the 1-minute tour", 8 pași): funcționează offline și **nu încarcă date singur** (arată doar părțile paginii). Varianta „Try the demo" care încarcă WISE 0855 și rulează blink-ul singură nu e făcută.
- [ ] **P2** **Secțiunea „About / Explain it to me”** (~2–3 h): ce e SPHEREx, de ce funcționează blink-ul, mover vs variabilă vs artefact, de ce un mover nu e automat Planet X.
- [x] **P2** **„Find Movers”** (v1 făcut 2026-11-07, `frontend/js/features/movers.js`, teste `scratch/test_movers.mjs`): puncte în poziții diferite între treceri → traiectorie → viteză (″/an) și direcție → listă clasată → click = traseul pe blink + „Check in sky map". Geometrie, fără rețele neuronale. **Rămas / limite:** (a) doar poziții, nu luminozitate (filtrul variabil schimbă luminozitatea între imagini); (b) are nevoie de ≥ 3 treceri; (c) mișcare < ~1 px peste perioadă = ca o stea fixă; (d) nu e testat pe date reale; (e) **mișcări mari** (paralaxa unui obiect îndepărtat dă sute de secunde de arc între două treceri la 6 luni – estimarea mea, neverificată) sunt la limita setării `maxSpeedPxPerYear = 60`; (f) potrivirea cu obiecte cunoscute folosește doar cele 5 obiecte de test, nu un catalog.
- [ ] **P2** **Potrivire cu SIMBAD**: „cunoscut” / „posibil cunoscut” / „necunoscut”; un candidat necunoscut nu e automat o planetă nouă.
- [ ] **P3** Scor de încredere pentru candidați (~3–5 h).
- [x] **P3** Estimator de clasă spectrală din raportul flux 4–5 µm vs 1–2 µm (făcut 2026-11-07, `features/spectrum.js`, „Spectrum along its path"): indiciu, nu clasificare; **netestat pe un obiect real** (lipsesc imaginile 4–5 µm ale unui obiect fără saturare).
- [x] **P3** Export candidați CSV / JSON (făcut 2026-11-07, `features/export.js`; fiecare rând spune dacă datele sunt reale sau sintetice și are permalink). VOTable: nefăcut.
- [ ] **P3** Web Worker pentru Difference/Stack (~1,5 h), dacă apar sacadări.
- [ ] **P3** Comparație multi-epocă cu WISE/NEOWISE pentru o bază de timp mai lungă (necesită date reale; ~5–8 h).
- [x] **P3** Estimarea paralaxei / distanței (făcut 2026-11-07, `features/parallax.js`, butonul „Look for a distant body"): corp al sistemului solar îndepărtat, căutat ca triplete de puncte din 3 treceri; **validat doar pe date sintetice** (demo „Planet X (simulated)" la 600 AU). Nu a rulat pe date reale; nu pretindem nicio planetă.
- [x] **P2** **Pagina cu rezultate reale** (ideea 10, făcută 2026-11-07, `frontend/results.html` + `frontend/data/real_results.json` + `js/results.js`, teste `scratch/test_results.mjs`): doar numere și grafice derivate (fără pixeli, fără imagini), eșecurile lângă succese (căutarea oarbă Planet X a eșuat, scrisă pe pagină). Citarea IRSA (DOI) e în subsol. **Rămas:** (a) textul exact de mulțumire IRSA, de copiat de pe pagina lor (acum e cu cuvintele noastre); (b) de potrivit fiecare imagine a noastră cu release-ul QR1/QR2/QR3; (c) licența datelor rămâne neverificată (pagina IRSA citită cere doar citare + mulțumire, dar asta nu e o analiză de licență); (d) de publicat doar dacă decizi tu (nu am împins nimic).
- [x] **P3** **Sky map: țara de deasupra punctului de pe cer** (cerută de tine, făcută 2026-11-07, `features/skyGeo.js` + `skyContext.js`, teste `scratch/test_skygeo.mjs`): caseta din colț dă coordonatele de sub cursor (sau centrul) și, în paranteză, țara aflată acum la zenit (latitudine = Dec, longitudine = RA − timp sideral). Hărțile de țări (Natural Earth 110 m, `world-atlas` 2.0.2) se încarcă din CDN, **nu sunt în repo**; dacă vrei harta în repo (offline), e o descărcare de ~105 KB care cere OK-ul tău. **Nu e testat:** panoramare cu degetul pe un telefon real, modul full screen.
- [x] **P1** **Calibrare pe date reale** (făcută 2026-11-07, noaptea, `scratch/calibrate_real.mjs`, `docs/VALIDATION.md` §10): injecție și recuperare de mobile false pe imaginile reale + test pe „cer gol" (imagini rotite/mutate la întâmplare). Rezultate: limită de detecție pe imagine 0,6–0,9 mJy în câmp curat, de 20–30× mai rea lângă o stea saturată; recuperare 70–98 % peste prag; numărul „chance lines" e conservator (0–13 % câmpuri goale cu un fals la regula implicită; 94–100 % cu regula inițială, deci testul ar fi prezis eșecul). **Rămas / decizii pentru tine:** (a) limita de 1 pentru „chance lines" lasă ~1 din 8 câmpuri goale cu 3 treceri să aibă un candidat fals; 0,01 ar fi ≤ 0,3 % și ar păstra toți cei 6 candidați reali, dar nu am schimbat regula; (b) scăderea fundalului local înainte de detecție ar reduce pierderea de factor 30 în câmpurile cu stea saturată: nefăcută, netestată; (c) Barnard D2 are acum 18 imagini (patru cutout-uri descărcate de tine la 22:47), deci cifrele din §2 (15 imagini) nu se mai reproduc exact.
- [x] **P2** **Limita pentru Planet X** (făcută 2026-11-07, `scratch/planet_x_limits.mjs`, §11): o expunere atinge V ≈ 17; un corp de 2–4 raze terestre e găsit în imagini simple doar până la ~150–270 AU; un Planet Nine la 300–800 AU e cu 3–5 magnitudini prea slab. Formulele (H–D–albedo, culoarea Soarelui, parametrii Planet Nine) sunt din memorie.
- [x] **P1** **Test oarb corect Planet X pe Makemake** (ideea C, făcută 2026-11-07, `scratch/fetch_body_cutouts.py` + `scratch/blind_planet_x.mjs`, `docs/VALIDATION.md` §12): 12 cutout-uri D1 de 30′ (75 MB, descărcate cu aprobarea ta), decalate la întâmplare cu 3–8′ de corp. **Rezultat:** cu opțiunile implicite ale aplicației 0 candidați; cu opțiunile relaxate 38 de candidați, dintre care unul e Makemake (53,3 AU, adevărul 52–53), iar un câmp gol dă 27–41 de candidați întâmplători. Deci prima recuperare reală oarbă, dar nu un rezultat. **Rămas / decizii pentru tine:** (a) nu știu care dintre opțiunile relaxate contează (suspect: lista de 80 de semințe pe imagine); (b) opțiunile implicite sunt prea stricte pentru un corp slab, iar cele relaxate dau o listă de ~33 de combinații întâmplătoare; (c) rms-ul fitului (0,46 px față de 0,85–1,04 px) pare să separe corpul, dar sunt doar 8 controale.
- [ ] **P2** **„Vezi orice obiect"** (cererea ta de la 23:25): vezi răspunsul din conversație și `docs/VALIDATION.md` §13 (primul studiu: 21 din 60 de puncte nu sunt în 2MASS/AllWISE, dar nu sunt „necunoscute"; cer verificarea artefactelor, mișcarea proprie din SIMBAD și detecție în ≥3 imagini).
- [x] **P1** **Pregătire de predare** (făcută 2026-11-07, `skill submission-check`): CI `.github/workflows/tests.yml` (versiunile acțiunilor din memorie, de verificat la prima rulare), README cu secțiunea Limitations și linkul demo (activ doar după push + Pages). Regulile oficiale 2026 (ghidul de predare apare pe 13 nov) **nu pot fi verificate acum**: site-ul spaceappschallenge.org nu se deschide din această rețea (certificat) și căutările nu dau regula despre lucrul început înainte de hackathon sau despre AI. Rămân ale tale: P0-urile din secțiunea 1, link-urile din fereastră privată și de pe telefon, textul exact de mulțumire IRSA, video etichetat real/sintetic.
- [x] **P2** Asteroizi cunoscuți (făcut 2026-11-07, `features/skybot.js`): SkyBoT răspunde direct browserului (CORS deschis), căutat la data fiecărei imagini. **Test pozitiv nefăcut** (asteroizii din cutout-urile noastre erau prea slabi).

---

## 3. Cod – calitate, securitate, testare

- [x] **P1** **Teste automate backend (pytest)** (făcut 2026-11-07, `backend/tests/`, 57 de teste): fotometrie (stea injectată), `cutout` (orientare, margini, cadre rotite), `stretch`, `hips_proxy` (allowlist, `..`, căi codificate, retry), `query` (fișier lipsă / corupt). **Rămas:** stratul HTTP din `backend/app.py` (nu e testat; `TestClient` cere un pachet pe care nu l-am instalat fără să-l verific).
- [ ] **P1** Cazuri-limită în teste: RA aproape de 0°/360° (359,99° → 0°), poli (±89°), FOV 1 și 30′, **un singur cadru**, **zero cadre**, imagini de dimensiuni diferite, URL cu parametri invalizi, API lent / căzut.
- [ ] **P1** Test cu cadre cu mulți NaN (fișier FITS sintetic).
- [ ] **P2** Restrânge CORS de la `*` la originile necesare (frontend-ul public), după ce știi unde găzduiești.
- [ ] **P2** Re-verifică proxy-ul HiPS: potrivire strictă de domeniu, fără redirectări către alte gazde.
- [ ] **P2** Performanță: 8–12 cadre la rezoluție mare (memorie browser), cutout-uri de 300×300 px.
- [ ] **P2** Test manual: **Firefox**, Safari dacă ai acces, **telefon real**; navigare doar cu tastatura; cititor de ecran (măcar o trecere).
- [ ] **P2** Curăță `console.log`, cod mort, comentarii învechite; rulează un linter.
- [ ] **P3** CI simplu (GitHub Actions: pytest + testele Node).
- [ ] **P3** Pin-uiește versiunile din `requirements.txt` (acum sunt „>=”), ca instalarea să fie reproductibilă.

---

## 4. Documentație

- [x] **P1** `LICENSE` (MIT, pus 2026-11-07, „Copyright (c) 2026 mateibut" – schimbă cu numele tău dacă vrei). **Încă de verificat:** cerința de licență pentru 2026 e **[neconfirmată]**; Aladin Lite e GPL-3 și e încărcat la rulare (vezi `CREDITS.md`) – întreabă/verifică dacă afectează licența aleasă.
- [x] **P1** **README**: **GIF animat** cu WISE 0855 în Blink și Difference (făcut 2026-11-07, `scripts/make_demo_gif.py` → `docs/img/demo.gif`, **etichetat „SYNTHETIC DATA - NOT SPHEREx"** pe fiecare cadru); ce face, cum rulezi, limitări, proveniența datelor. Rămâne o captură de ecran a aplicației (nu am putut face una de calitate cu panoul de previzualizare îngust).
- [x] **P1** **`CREDITS.md` / „Sources”** (primă versiune 2026-11-07; verifică formulările exacte de mulțumire pe paginile arhivelor înainte de predare) [termenii cer citarea tuturor surselor, chiar open-source]:
  - date: SPHEREx / NASA IPAC IRSA, 2MASS, AllWISE, DSS2 (copii HiPS IRSA, originale CDS), SIMBAD (mirror Harvard);
  - coordonatele obiectelor test: referințele din `frontend/js/targets.js` (Gaia DR3 / `2020yCat.1350`, Kirkpatrick+2021 `2021ApJS..253....7K`, Vallenari+ `2007A&A...474..653V`);
  - biblioteci: FastAPI, uvicorn, astropy, numpy, Pillow, Plotly 2.35.2, Aladin Lite 3.6.5;
  - fonturi: Inter, Space Grotesk (Google Fonts);
  - unelte AI.
- [ ] **P1** **Declarația de folosire a AI + istoricul dezvoltării** (obligatorie [confirmat: FAQ cere descrierea uneltelor AI]): spune cinstit că proiectul a fost construit cu **Claude Code (Anthropic)**, ce părți, ce ai verificat tu, când a început. Aceeași poveste în README și în formularul de predare.
- [ ] **P1** `docs/DATA_CHECKLIST.md` actualizat cu rezultatele de pe date reale (ce s-a confirmat, ce s-a schimbat).
- [ ] **P1** Secțiune **„Limitări cunoscute”**: fotometrie necalibrată, lungime de undă, flag-uri, mișcare sub-pixel, ce rulează pe mock vs real.
- [ ] **P2** `docs/SCIENCE.md`: cum funcționează blink / difference / trail, de ce 30 de zile, cum se calculează poziția prezisă (SIMBAD + mișcare proprie, fără paralaxă), cum distingi mover / variabilă / artefact, de ce un candidat nu e „Planet X”.
- [ ] **P2** Documentația API (`/api/cutouts`, `/api/photometry`, `/api/hips`, `/api/health`) cu exemple `curl`.
- [ ] **P2** Ghid de utilizator scurt (cu capturi): „cum găsești un obiect în mișcare”.
- [ ] **P2** `docs/ARCHITECTURE.md`: schema fluxului (formular → getCutouts → player → măsurare), contractul de date.
- [ ] **P3** `CHANGELOG.md`, `CONTRIBUTING.md`.
- [ ] **P2** Actualizează `docs/SUBMISSION.md`: scoate „~30 s” (neconfirmat) și pune „de verificat pe 13 nov”.

---

## 5. Repo și găzduire

- [ ] **P1** Repo GitHub **public**, cu istoric curat (commit-uri cu mesaje clare); verifică să nu urce `.venv`, `cache`, `data`, chei sau parole.
- [ ] **P1** **Demo public** fără instalare. GitHub Pages găzduiește doar frontend-ul static → rulează pe **mock**; **trebuie etichetat** ca „date sintetice”, nu ca serviciu SPHEREx real. **Pregătit 2026-11-07, NEPUBLICAT:** `.github/workflows/pages.yml` + insigna din antet scrie „Synthetic demo data". Rămâne la tine: repo pe GitHub, push, *Settings → Pages → Source: GitHub Actions*.
- [ ] **P2** Dacă vrei date reale în demo online: backend găzduit separat (ex. un serviciu Python) – atenție la CORS, memorie, limite de plan gratuit, timp de pornire la rece. Altfel: GIF/video cu date reale + demo pe mock.
- [ ] **P1** Testează linkul demo dintr-o **fereastră anonimă** și pe telefon.
- [ ] **P2** Adaugă descriere, subiecte (topics) și un link către demo în pagina repo-ului.

---

## 6. Prezentare și predare

### 6.1 Video / demo [cerința 2026 – neconfirmată; ghidul apare pe 13 nov]
- [ ] **P1** Pe **13 nov** citește **Project Submission Guide** și **Judging & Awards Guide**: video sau slide-uri? lungime maximă? subtitrare? limbă? câmpuri obligatorii? criterii de jurizare?
- [ ] **P1** Scenariu (din `docs/SUBMISSION.md`): problema → soluția în acțiune (WISE 0855: Blink → Difference → tick-uri verzi) → **ce e real și ce e simulat** → de ce contează → credite și declarația AI.
- [ ] **P1** Pregătește **două versiuni** (≈30 s și ≈90 s); le finalizezi după ce vezi limita.
- [ ] **P1** **Subtitrare în engleză** (era obligatorie în 2025 [neconfirmat pentru 2026]).
- [ ] **P1** Videoclip **creație proprie**, **fără chipuri / nume / voci de persoane sub 18 ani** [confirmat: termeni]; muzica / fonturile cu drepturi clare.
- [ ] **P1** **Link public** (YouTube / similar, nu fișier încărcat în 2025 [neconfirmat]); deschide-l din fereastră anonimă.
- [ ] **P2** Folosește butonul „Record video” din aplicație pentru secvența de blink; înregistrare de ecran pentru restul (verifică ce unealtă ai).
- [ ] **P2** Alternativă: prezentare cu slide-uri **în engleză**, dacă ghidul o permite (în 2025: maximum 7 slide-uri [neconfirmat]).

### 6.2 Pagina proiectului pe spaceappschallenge.org
- [ ] **P1** Titlu, rezumat scurt, descriere detaliată (problema, soluția, impactul, cum se folosește, ce e real vs mock).
- [ ] **P1** Link către repo, demo, video; **declarația AI**; sursele citate.
- [ ] **P1** Imagini pentru pagină: JPG / PNG / GIF, **până la 10 MB** [neconfirmat pentru 2026; video nu se încarcă, se leagă].
- [ ] **P1** **Totul în engleză** (pagina și materialele legate) [neconfirmat pentru 2026, dar probabil].
- [ ] **P1** Bifează acordul cu termenii și completează **toate câmpurile obligatorii** (condiția minimă pentru jurizare globală în 2025 [neconfirmat pentru 2026]).
- [ ] **P1** Aliniază povestea cu criteriile (în 2025: Impact, Creativity, Validity, Relevance, Presentation – verifică lista 2026): arată **un exemplu convingător**, nu toate funcțiile.

### 6.3 Predare
- [ ] **P1** Predă **cu cel puțin 30 de minute înainte** de 15 nov, 23:59 (ora locală). În 2025 predarea era finală, fără editări după termen [neconfirmat pentru 2026].
- [ ] **P1** După predare: deschide pagina proiectului dintr-o fereastră anonimă și verifică toate linkurile (repo, demo, video).
- [ ] **P1** Salvează o **copie locală** a textului și a materialelor predate.

---

## 7. Pregătire permisă acum (nu dezvoltă soluția)

Verifică cu organizatorii dacă și aceasta e în regulă; pare în spiritul „poți pregăti și învăța înainte”.
- [ ] Citește pagina provocării și documentația SPHEREx / IRSA; notează întrebări pentru forum.
- [ ] Creează / verifică conturile: Space Apps (înregistrare), GitHub, YouTube, Space Apps Connect.
- [ ] Pregătește unelte: program de înregistrat ecranul, editor video pentru subtitrări, spațiu pentru fișiere.
- [ ] Citește termenii și FAQ-ul.
- [ ] Hotărăște cine din echipă face ce (dacă ai echipă).
- [ ] Fă un plan al orelor pe 14–15 nov (Anexa B).

---

## Anexa A – Postări pentru Space Apps Connect (de verificat și adaptat de tine)

**Project Submission Help – titlu:** *Prior prototype started before the hackathon – is it allowed?*

> Hello! I'm registered for the 2026 challenge "Planet X and SPHEREx". Before the official start I began a prototype of a possible solution (started 5 Nov 2026): a web tool with a blink viewer for SPHEREx-style cutouts, built on synthetic data because I have no real SPHEREx files yet. It was built with AI assistance (Claude Code), and I will describe that in the submission.
>
> I read the reminder not to begin project work before the hackathon starts. My questions:
> 1. Can this prototype be submitted, or should I restart on 14 Nov?
> 2. If it can, how should I disclose what existed before 14 Nov?
> 3. What are the video length limit and the repository/licence requirements this year?
>
> I'd rather follow the rules than risk disqualification. Thank you!

**Challenges – titlu:** *Planet X and SPHEREx – how to get SPHEREx cutouts and what the FITS files contain*

> Which IRSA service is recommended for getting SPHEREx cutouts (SIA, TAP, or a cutout service)? Is there documentation for the FITS layout (HDU names, flag-bit meanings, time and detector keywords) and for the wavelength at a given pixel (linear variable filter)? Are there small sample files for testing?

## Anexa B – Plan orientativ pentru 14–15 nov (dacă prototipul e acceptat)

| Moment | Ce faci |
|---|---|
| 14 nov 09:00–11:00 | Citește ghidurile finale, confirmă cerințele, fixează MVP-ul de predare |
| 11:00–14:00 | Date reale: fișier → `inspect_fits.py` → CONFIG → validare WISE 0855 |
| 14:00–18:00 | Demo ghidat + About; (opțional) Find Movers de bază |
| 18:00–21:00 | Teste, repo public, demo public |
| 21:00–23:00 | README cu GIF, CREDITS, declarația AI |
| 15 nov 09:00–12:00 | Corecturi, validare științifică, cazuri-limită |
| 12:00–16:00 | Video (cele două versiuni), subtitrări, imagini pentru pagină |
| 16:00–19:00 | Pagina proiectului, test din fereastră anonimă |
| 19:00–23:00 | Predare (țintă: înainte de 23:30), verificare finală |

Dacă datele reale nu pot fi obținute la timp, MVP-ul de predare e: demo public pe mock **etichetat clar**, WISE 0855 în Blink + Difference + poziție prezisă,
declarația AI, README cu limitări, video cu mențiunea „date sintetice”.

## Anexa C – MVP de predare (minimul care trebuie să meargă perfect)

1. Demo public, deschis fără instalare.
2. Un exemplu convingător: WISE 0855 (Blink + Difference + poziția prezisă).
3. **Proveniența datelor, spusă clar** (real vs sintetic).
4. Explicație științifică scurtă (mover vs variabilă vs artefact).
5. Repo public: instrucțiuni, licență, credite.
6. Declarația AI și istoricul dezvoltării.
7. Video / slide-uri conform ghidului din 13 nov.
8. Toate câmpurile paginii proiectului completate, predat cu 30 de minute înainte.
