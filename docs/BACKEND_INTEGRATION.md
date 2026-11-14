# Cum aducem datele reale în aplicație (când se deschid resursele)

> **Actualizare 6 nov:** resursele IRSA pentru SPHEREx sunt **publice și le-am citit**. Faptele verificate (structura fișierelor, TAP, cutout, WCS-WAVE, flag-uri, performanță) sunt în **[IRSA_FACTS.md](IRSA_FACTS.md)**.
> Consecințe: arborele de decizie de mai jos se reduce la **cazul A/B hibrid**: **TAP** găsește imaginile (timp, bandă, poligon), apoi **cutout server-side** pe fiecare (`?center=ra,dec&size=5arcmin`). Presupunerile marcate „necunoscute” în tabelul din secțiunea 1 sunt acum în mare parte **confirmate** (IMAGE în HDU 1, FLAGS în HDU 2, perechile de detectoare, lungime de undă prin WCS-WAVE, definiția biților). Rămân neclare: cuvântul-cheie al timpului observației în header (folosim TAP), dimensiunea maximă a cutout-urilor, limitele de rată, termenii datelor.
> Modificări de cod necesare când se permite (nu le fac acum): `query.py` → TAP + cutout în loc de fișiere locale; timp din `time_bounds_lower`; λ din WCS-WAVE; mască de biți „răi” (nu „orice bit”, biții 12 și 21 sunt informativi); VARIANCE pentru erori; ZODI; cutout ne-pătrat cu NaN la margini; 7–12 cereri paralele; reîncercări; scara pixelului ~6,15″.

Stare: 6 nov 2026. Nu știm încă **metoda de acces** la datele SPHEREx; nu o ghicim. Documentul spune cum decidem, ce construim în fiecare caz și ce trebuie să afle frontend-ul.

Principiul de bază (deja în cod): **frontend-ul vorbește doar cu `getCutouts()` și `getPhotometry()`**. Tot ce e specific datelor reale se schimbă în backend, în spatele aceluiași contract. Asta ne lasă să proiectăm frontend-ul acum.

---

## 1. Ce știm și ce nu

| Subiect | Stare |
|---|---|
| Arhiva datelor | IRSA (NASA/IPAC) — rețeaua ta ajunge la `irsa.ipac.caltech.edu` (testat); CDS (Strasbourg) nu |
| Metoda de acces (SIA / TAP / serviciu de cutout / fișiere întregi) | **Necunoscută**; după documentația IRSA / tab-ul Resources / forum |
| Structura FITS (HDU-uri, cuvinte-cheie) | **Necunoscută**; presupunerile sunt în `backend/spherex/query.py` |
| Lungime de undă la poziție (LVF) | **Necunoscută**; trebuie să existe fie un HDU de hartă, fie o formulă în documentație |
| Flag-uri | **Necunoscute** (definiția biților) |
| Dimensiuni și limite (rate limit, mărimea fișierelor) | **Necunoscute** |

## 2. Arbore de decizie (după ce citim resursele)

| Dacă resursele ne dau… | Atunci backend-ul face… | Efort |
|---|---|---|
| **A. Serviciu de cutout server-side** (cerem un decupaj după RA/Dec/mărime) | Interogăm lista de imagini care acoperă poziția, cerem un cutout pe fiecare, le aliniem, le salvăm în cache | mic–mediu |
| **B. Căutare de imagini (SIA/TAP) + fișiere FITS întregi** | Găsim fișierele, le **descărcăm și le păstrăm în cache**, tăiem cutout-ul local (cum facem deja pe fișiere sintetice) | mediu |
| **C. Doar descărcări în bloc / fără acces programatic** | **Pre-calculăm cutout-uri** pentru cele 5 obiecte test (offline) și le livrăm ca fișiere statice; backend-ul live rămâne pentru poziții arbitrare doar dacă se poate | mediu |
| **D. Nimic accesibil la timp** | Demo pe mock **etichetat clar**; eventual date reale din alt survey IRSA (WISE multi-epocă) ca „dovadă de concept” | mic |

**Strategia recomandată în toate cazurile:** *pre-calculează și publică ca fișiere statice* cutout-urile celor 5 obiecte (dacă termenii datelor permit redistribuirea; **de verificat**). Atunci demo-ul public (GitHub Pages) rulează pe **date reale pentru cele 5 obiecte**, fără server, și backend-ul live e un bonus pentru poziții libere. Reduce riscul de „serverul a căzut în timpul jurizării”.

## 3. Conducta (pipeline) și stadiul fiecărei etape

| # | Etapă | Stare azi | Ce se schimbă pe date reale |
|---|---|---|---|
| 1 | Căutăm imaginile care acoperă (RA, Dec) | pe fișiere locale | interogare IRSA (SIA/TAP) |
| 2 | Obținem fișierul / decupajul | citire locală | descărcare + cache; cutout server-side dacă există |
| 3 | Citim header-ul (MJD, detector, unități) | cuvinte-cheie presupuse | cuvinte-cheie reale |
| 4 | Construim WCS, verificăm validitatea | merge pe TAN simplu | distorsiuni (SIP etc.), verificare cu stele cunoscute |
| 5 | **Lungime de undă la poziția țintei** | un tabel nominal per detector | hartă de lungimi de undă / formulă |
| 6 | Tăiem + aliniem pe grila nord-sus | merge | verificăm pe WISE 0855 (< 0,5 px) |
| 7 | Fundal, NaN-uri, stretch comun pe detector | merge | zgomot real, NaN-uri multe |
| 8 | Flag-uri → mască + procent | orice bit ≠ 0 | doar biții relevanți |
| 9 | Fotometrie de apertură | merge, necalibrată | unități confirmate |
| 10 | Cache + servire | merge | politică pentru fișiere mari |

## 4. Contractul de date v2 (ce ar trebui să-i dăm frontend-ului)

Pentru frontend-ul regândit contractul actual e prea sărac. Propuneri (se adaugă **fără să strice** câmpurile vechi):

**Per cadru:**
- `provenance`: `{ kind: "real" | "mock" | "synthetic-fits", productId, sourceUrl (link IRSA), processingVersion }`
- `wavelengthAtTargetUm` (+ `wavelengthMinUm/MaxUm` ale benzii) — **esențial pentru placa Epocă × λ**
- `exposureId`, `observationId`
- `quality`: `{ validFraction, noiseRms, flagLegend }`
- `pixelScaleArcsec`, `rotationDeg`, `timeScale` (UTC/TDB), `exposureSeconds` dacă există
- `units` (ex. "MJy/sr")

**Imaginea:** în plus față de PNG, un endpoint de **date numerice** (`/api/cutout-data`): Float32 + JSON.
- Un cutout de 49×49 float32 = ~10 KB; unul de 300×300 = ~360 KB. Sunt mici, deci le putem trimite brute.
- Avantaje: **stretch interactiv** (negru/alb/gamma), **cititor la cursor cu valori reale**, Difference/Stack în unități fizice, fotometrie în browser, hărți de culoare, fără re-descărcări.
- PNG-ul rămâne pentru miniaturi și previzualizări.

**Lista de cadre** să includă și cadrele „nefolosibile” cu motiv (ex. „în afara câmpului”, „prea multe flag-uri”), ca interfața să poată afișa stări **parțiale** în loc de tăcere.

## 5. Fiabilitate și performanță

- **Cache pe disc** (există) + **prefetch** pentru cele 5 obiecte test.
- **Timeouts** și **reîncercări** limitate; **circuit breaker** (după N erori, răspunsuri rapide cu eroare clară).
- **Progres:** pentru interogări lente, răspuns `202` + identificator de lucru + sondare, sau **Server-Sent Events**, ca frontend-ul să arate stări reale („se caută 12 imagini… 4/12 descărcate”).
- **Degradare grațioasă:** dacă IRSA nu răspunde, interfața oferă „Folosește datele demo” (și insigna se schimbă în MOCK).
- **Limite:** dimensiunea cutout-ului (FOV maxim 30′), număr de cadre per cerere, dimensiunea răspunsului.
- **Observabilitate:** jurnale cu timp pe etapă (căutare / descărcare / cutout / stretch), fără date personale.

## 6. Securitate

- **SSRF:** backend-ul apelează **doar** gazde din allowlist (IRSA, eventual altele confirmate); validează parametrii; fără redirectări către alte gazde.
- **CORS** restrâns la originea frontend-ului public (acum `*`).
- **Nicio cheie sau parolă în frontend.** Dacă un serviciu cere autentificare, rămâne pe server și în variabile de mediu (nu în git).
- Limite de mărime și timp pe fiecare cerere; mesaje de eroare fără detalii interne.

## 7. Găzduire (variante)

| Variantă | Pro | Contra |
|---|---|---|
| **Doar static (GitHub Pages) cu cutout-uri pre-calculate** | fără server, sigur la jurizare | doar pentru cele 5 obiecte |
| Static + backend pe un serviciu gratuit de Python | poziții libere | pornire la rece, limite de plan, CORS, întreținere |
| Doar local (pentru video) | control total | nu se poate încerca de juriu |

Recomandare: **static cu date reale pre-calculate pentru cele 5 obiecte** + backend live opțional.

## 8. Ce adunăm când se deschid resursele (lista ta)

- [ ] Link-urile oficiale: pagina provocării (tab Resources), documentația SPHEREx la IRSA, tutoriale.
- [ ] Numele serviciilor de acces (SIA / TAP / cutout) și un **exemplu de cerere + răspuns**.
- [ ] Un fișier FITS real (sau un cutout real) → `inspect_fits.py`.
- [ ] Documentația header-ului: cuvinte-cheie de timp, detector, unități.
- [ ] Documentația **lungimii de undă pe pixel** (hartă / formulă).
- [ ] Definiția **biților de flag**.
- [ ] Termenii de utilizare ai datelor (redistribuire, citare).
- [ ] Limite: rate limit, dimensiunea fișierelor, durata tipică a unei cereri.
- [ ] Răspunsurile din forum la întrebările din `docs/TODO.md` (Anexa A).

## 9. Validarea pe date reale (ordinea)

1. `inspect_fits.py` → bifează `DATA_CHECKLIST.md`.
2. Un singur cadru real, ca imagine: arată plauzibil (stele punctuale, nu zgomot)?
3. WCS: stele cunoscute (SIMBAD) pe pixelii așteptați.
4. Mai multe cadre ale aceluiași câmp: se suprapun (corelație mare)?
5. **WISE 0855 pe tick-urile verzi**, offset < 0,5 px în fiecare cadru.
6. Lungimea de undă: spectrul unei stele obișnuite arată plauzibil (descrescător spre 5 µm).
7. Fotometrie: variația unei stele constante între cadre e mică la aceeași λ.
8. Performanță: timp de la click la imagini pe 8–12 cadre.
