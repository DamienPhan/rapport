# CLAUDE.md — Contexte projet « Rapports de mission »

Ce document donne à toute IA (ou développeur) reprenant ce projet le
contexte complet : qui l'utilise, pourquoi, comment c'est construit, quelles
décisions ont été prises et pourquoi, quels pièges éviter.

---

## 0. Commandes

```bash
npm install       # installe pdfjs-dist (nécessaire pour les tests PDF)
npm test          # lance tests/parser.test.js (unitaires + intégration PDF)
npm run serve     # sert le dossier en http://localhost:8080 (python3 -m http.server 8080)
```

Pas de build, pas de lint configuré. Les modules ES exigent `http://` — ne
jamais ouvrir `index.html` en `file://` (CORS bloque les imports).

`tests/parser.test.js` est un runner maison (pas de framework) : chaque cas
est déclaré avec `test('nom', fn)` et tous les tests s'exécutent
séquentiellement à chaque `npm test` — il n'y a pas de mécanisme pour cibler
un seul test par nom ; pour isoler un cas pendant un débogage, commenter
temporairement les autres appels à `test(...)` dans le fichier.

---

## 1. Qui, quoi, pourquoi

**Utilisateur** : Damien P., porteur bagagiste / greeteur à l'aéroport de
Nice Côte d'Azur (NCE), également étudiant en M1 informatique. Utilise
l'app seul ou en partage le lien avec ses collègues porteurs.

**Besoin métier** : chaque jour, l'entreprise sous-traitante du
handling diffuse un planning PDF généré par TCPDF listant **toutes** les
missions de **tous** les porteurs (greeters, arrivées, départs, missions
agences hors-ACA...). Un porteur doit en isoler ses propres missions et
produire, pour chacune, un rapport texte structuré à coller dans un autre
outil (tablette de pointage). Faire ça à la main est lent et source
d'erreur de copie.

**Solution** : une app web statique, zéro backend, zéro build, déployée
sur GitHub Pages, qui extrait automatiquement les missions d'un porteur
depuis le planning et pré-remplit des formulaires éditables avant
génération du rapport.

**Contrainte de déploiement** : GitHub Pages sert des fichiers statiques.
Pas de serveur, pas de base de données, pas de compilation. Tout doit
tourner dans le navigateur.

---

## 2. Fichiers du dépôt

**Architecture modulaire (v2)** — ES modules natifs, zéro build. La logique
métier (`core/`, `store/`) est PURE (aucun accès DOM) et réutilisable telle
quelle lors d'un futur passage natif. Seule `ui/app.js` touche le DOM.
(Structure des fichiers : `find src -type f` — arborescence reconstructible,
non dupliquée ici.)

**Correspondance avec l'ancienne v1 (monolithe)** : l'ancien `parser.js`
(IIFE globale `MissionParser`) est devenu `src/core/parser-pdf.js` (module ES
piloté par config). L'ancien `index.html` contenait tout (UI + moteur texte +
état) ; ce code est désormais réparti entre `core/`, `store/` et `ui/app.js`.

**Frontière d'architecture à respecter absolument** : ne JAMAIS ajouter
`document.`/`window.`/`localStorage.` dans `core/` ou `store/`. Si un module
core a besoin d'une donnée du DOM, l'UI la lit et la passe en argument. Les
handlers appelés en `onclick=`/`onchange=` inline doivent être exposés via
`window.X = X` à la fin de `ui/app.js` (sinon invisibles en scope module).

Aucun backend. `pdf.js` est chargé depuis un CDN. Les modules ES exigent
`http://` (servir via `npm run serve`), pas `file://`.

---

> **Note de numérotation.** L'ancienne §3 « Architecture — les deux moteurs
> d'extraction » et l'ancienne §6 « Méthode de validation » ont été déplacées
> vers `src/core/CLAUDE.md` (chargé automatiquement pour tout travail sous
> `src/core/`/`src/config/`) ; l'ancienne §8 « Upscaling vers un autre site »
> est devenue le skill `upscale-new-site`. La numérotation ci-dessous garde
> ses trous (4, 5, 7, 9) plutôt que d'être renumérotée, pour ne pas invalider
> les nombreux renvois internes (« voir §5 point 25 », etc.) dans le reste du
> document et dans `src/core/CLAUDE.md`.

## 4. Modèle de données et règles métier

### Structure d'une mission (`emptyMission()` dans `index.html`)

```js
{
  booking, date, vol, terminal, type,       // ARR | DEP | TRS | Service
  client, greeteur, greeteurPhone, contactPhone, pax,
  prebooking,                                // PRÉ-BOOKING | LIVE
  detaxe,                                    // Oui | Non | N/A
  lieuRencontre, lieuRencontreAutre,
  lieuDepose, lieuDeposeAutre,               // 'AUTO_CHECKIN' = calculé depuis le vol ; 'N/A' possible
  probleme, porteurs, satisfaction,          // satisfaction : ... | N/A
  bagStandard, bagHorsFormat, bagCage,      // bagStandard défaut '1' ; hf/cage défaut '0', inputs numériques libres
  sortTime,                                  // pour le tri chronologique ET l'heure affichée dans la bannière (fmtTime)
  bookingOptions, flightOptions              // peuplés uniquement si "chips"
}
```

**Champs ajoutés récemment** : `greeteurPhone`, `contactPhone` (téléphones
cliquables, voir `src/core/CLAUDE.md`). Le type accepte désormais **`TRS`** (transit terminal à
terminal) en plus de ARR/DEP/Service.

**Tous les champs de `createMission()` sont des constantes fixes** (plus
d'objet `defaults`/`syncDefaults` mutable — **supprimé**, voir §5 points
27-28). Une nouvelle mission (extraction, changement de porteur, ajout
manuel) ne doit jamais hériter d'une valeur saisie sur une AUTRE mission,
quel que soit le champ : `bagStandard` vaut `'1'`, `bagHorsFormat`/`bagCage`
valent `'0'`, `probleme` vaut `''`, `detaxe` vaut `'Non'`, `lieuRencontre`
vaut `'Dépose minute'`, `porteurs` vaut `'1'`, `satisfaction` vaut
`'Excellente'`, etc. Historique : le mécanisme `defaults` (« préférences
glissantes ») pré-remplissait volontairement certains champs avec la
dernière saisie, jusqu'à ce que l'utilisateur signale le même bug deux fois
de suite (d'abord `bagStandard`, puis `bagHorsFormat`/`bagCage`, puis
explicitement pour « tous les champs ») — le mécanisme entier a été retiré
plutôt que corrigé champ par champ. Aucune extraction (PDF ou copier-coller)
ne renseigne jamais ces champs, d'où des valeurs de repli fixes plutôt
qu'une extraction réelle.

### Règles de routage par défaut (`applyLieuDefaults`, appliqué une fois à
l'extraction, jamais réécrasé par l'undo ou l'édition manuelle)

| Type | Lieu de rencontre | Lieu de dépose |
|---|---|---|
| Arrivée (ARR) | Tapis bagage | Parking pro |
| Départ (DEP) | Dépose minute | Check-in + vol (`AUTO_CHECKIN`) |
| Transit (TRS) | *(vide)* | *(vide)* |

Décision métier explicite de Damien (pas une déduction du planning) : ces
valeurs sont volontairement déterministes par type, indépendamment de ce
que dit l'itinéraire PDF. Si un cas dérogeant existe, c'est à corriger
manuellement sur la carte.

### Identification du client (`clientFromColumn` / logique équivalente PDF)

- **ACA (Aéroport Nice Côte d'Azur)** : booking affiché = `M#xxxxx` (numéro
  de mission interne), pas la réf `nnnnn-n` du planning.
- **Agence externe** (réservations directes, ex. location de voiture,
  Kuoni, SAS SAME...) : booking = référence `[2026-xxxxxx]`, client = nom
  de l'agence/personne.
- **Monaco Mediax**, **WELL'COM AIR** : reconnus par motif dédié, mêmes
  règles que ACA pour le format mais sans M#.
- **Clients groupe ALL-CAPS** (`GM FINANCIAL CHILE`, `WD CONSEILS`...) :
  fallback regex sur un nom entièrement capitalisé, `tok = 'OTHER'`. À la
  différence des missions agence `[2026-xxxxxx]`, le greeter est extrait
  normalement.
- Missions « Service » (sans vol, ex. dépose simple) : type forcé à
  `Service`, vol/terminal vides.

### Conventions de saisie / rapport (décisions Damien)

- **Bagages** : `bagStandard` vaut **1 par défaut** (les missions extraites
  n'indiquent jamais le nombre réel) ; `bagHorsFormat` et `bagCage` valent
  0. Hors-format et cage animal sont des **inputs numériques libres** (il
  peut y en avoir beaucoup — l'ancien select 0–5/N-A était trop limité).
  Dans le rapport généré, hors-format/cage affichent **`N/A` (majuscules) si
  vide ou 0**, sinon le nombre ; le total = standard + hors-format + cage
  (valeurs nulles ou `N/A` comptées comme 0).
- **NO SHOW** (`markNoShow`, bouton rouge dans l'entête de carte) : marque
  une mission « client absent ». Conserve l'**identité** (booking, date,
  client, greeteur, prébooking, type, vol, terminal) et met **tout le reste
  à `N/A`** (pax, bagages, détaxe, lieux, satisfaction) avec
  `probleme = 'NO SHOW'`. `syncAll()` est appelé avant pour capturer les
  éditions manuelles. Action annulable via l'undo. A nécessité l'ajout d'une
  option `N/A` aux deux sélecteurs de lieu et au sélecteur satisfaction.
- **Mission manuelle** (`addManualMission`) : par défaut **LIVE** avec un
  booking pré-rempli **`2026-`**. **Insérée en tête de liste** (`unshift`)
  et un bouton « + Ajouter une mission manuelle » est présent **en haut ET
  en bas** de la liste (pour ne pas scroller toute la journée avant d'en
  ajouter une).
- **Majuscules / format de saisie** : les champs vol, client et greeteur
  forcent les majuscules à la frappe (`oninput="this.value=this.value.toUpperCase()"`) ;
  le terminal n'accepte que des chiffres (`inputmode="numeric"` +
  `replace(/\D/g,'')`).
- **Validation avant rapport** (`validateMission`) : `generateReport` refuse
  de générer si un champ obligatoire manque. Requis partout : booking + pax ;
  requis en plus pour ARR/DEP : vol + terminal (pas pour TRS/Service). Les
  champs manquants reçoivent une bordure rouge (`.field-error`, retirée dès
  la saisie), un message rouge listant les manques s'affiche, et le focus
  va au premier champ vide.
- **Bannière de carte** : affiche l'heure de début à côté du numéro de
  booking, sans le mot « Booking » (`28856 · 08:00`) via `fmtTime(sortTime)` ;
  rien si l'heure est inconnue (`sortTime` = 9999, cas des missions
  manuelles). `sortTime` survit à `syncAll` (aucun champ DOM correspondant)
  et est préservé au choix d'un chip booking (`pickBooking`).
- **Format du rapport généré** (`generateReportText` dans
  `src/core/report.js`) : la ligne booking affiche le `#` **après** les deux
  points — `Booking : #30258` (et non `Booking # : 30258`). La section « Un
  problème rencontré ? » affiche **« Aucun problème »** quand `m.probleme`
  est vide (au lieu d'une ligne blanche) ; reste inchangé si `probleme` vaut
  autre chose (ex. `'NO SHOW'`). Le total de bagages est dupliqué **tout en
  haut du rapport**, avant « 1. Informations générales », en plus de son
  emplacement d'origine en section 2 — pour le voir sans avoir à faire
  défiler tout le rapport. Les deux lignes restent toujours identiques
  (même calcul `total`), aucune des deux n'a été retirée. La ligne du haut
  est en **majuscules, encadrée d'astérisques Markdown**
  (`**TOTAL BAGAGES PRIS EN CHARGE : N**`) pour qu'elle ressorte visuellement
  une fois collée dans un outil externe (tablette de pointage) qui
  n'interprète pas forcément le Markdown — les astérisques restent visibles
  tels quels si le gras n'est pas rendu, l'un ou l'autre suffit à faire
  ressortir la ligne.
- **Copie du numéro de vol** : un bouton 📋 à côté du champ « Vol - code
  IATA » (`copyFlight` dans `src/ui/app.js`) copie sa valeur dans le
  presse-papiers. Réutilise la même logique clipboard fiabilisée iOS que
  `copyReport` (factorisée dans `writeClipboard`, voir décision historique
  n°20) — ne pas dupliquer cette logique si un futur champ a besoin du même
  bouton, l'étendre via `writeClipboard`.

### Référentiels auto-alimentés (porteurs, greeters)

Ajouté pour éliminer le besoin de redéploiement à chaque changement
d'effectif ou de greeter. Mécanisme (`harvestRoster`, `rosterMerge`,
`refreshRosterUI` dans `index.html`) :

1. À chaque chargement de planning (PDF ou texte collé), le texte brut
   est scanné ligne par ligne.
2. Toute ligne matchant le pattern d'un greeter labellisé
   (`greete?r[\s:]*NOM`) alimente la liste des greeters.
3. Toute ligne ressemblant à un nom de porteur (`Prénom N.` ou
   `Prénom NOM`) et ne matchant pas un préfixe de bruit connu
   (`PORTER_HARVEST_BLOCK` : Flight, Greeter, Note, Phone, Terminal,
   Aéroport, Parking, Bagage...) alimente la liste des porteurs.
4. Les nouveautés sont fusionnées dans `localStorage` (`customPorters`,
   `customGreeters`) et injectées dans le `<select>` porteur et la
   `<datalist>` greeter.

Validé sans faux positif sur 2 plannings réels complets (15 porteurs / 17
greeters extraits, zéro nom de passager ou d'agence capté par erreur).

**Piège à surveiller** si on modifie `PORTER_HARVEST_RE`/`BLOCK` : tout
nom de personne à deux mots capitalisés peut matcher (ex. un nom de
passager mal filtré). Toujours retester sur un planning complet avant de
relâcher le filtre.

---

## 5. Décisions et corrections historiques importantes

Dans l'ordre chronologique des sessions de développement (utile pour
comprendre *pourquoi* le code est comme il est, et éviter de réintroduire
un bug déjà corrigé) :

1. **Diagnostic initial** : le scrambling du copier-coller est un
   artefact d'aplatissement, pas un problème d'heuristique. → création du
   chemin PDF par coordonnées (`parser.js`).
2. **Bug terminal numérique perdu** (`Terminal NCE 1` au lieu de
   `Terminal 1`) : le token `NCE` de la colonne Véhicule s'intercalait
   entre `Terminal` et le numéro lors de la fusion col3+col4. Fix :
   strip du token `NCE` isolé avant parsing du terminal.
3. **Bug mission agence mal attribuée** : le nom du porteur, très au-dessus
   de sa réf booking, tombait dans la bande Y de la mission précédente.
   Fix : alignement par rang Y des noms de porteur plutôt que bandage
   horizontal pur (voir `src/core/CLAUDE.md`, chemin PDF, point 5).
4. **Faux positif « cluster scrambled » sur le copier-coller** : une
   mission individuellement claire était mise en chips uniquement parce
   qu'un voisin de son cluster était ambigu. Fix : jugement de propreté
   local par mission (booking → booking suivant), pas par cluster (voir
   `src/core/CLAUDE.md`, chemin copier-coller). Question légitime posée et vérifiée à l'époque : « deux
   personnes peuvent avoir une mission chacune sur le même vol » — validé
   non cassant car le découpage est par réf booking, jamais par vol ; deux
   porteurs sur un même vol ont deux réf booking distinctes, donc deux
   scopes séparés, jamais de collision de dédoublonnage entre eux.
5. **Bug attribution croisée sur le copier-coller** (régression introduite
   par le fix précédent) : sur un collage où le nom d'un porteur est
   dumpé **avant** sa propre réf booking (donc juste après la mission
   d'un autre porteur), le scope "1 vol, 1 booking" validait à tort la
   réf du voisin. Fix : garde supplémentaire — une ligne n'est clean que
   si **aucun autre nom de porteur** n'apparaît entre la réf booking
   candidate et le porteur recherché.
6. **Greeters manqués — libellé en majuscules** (`GREETER:` au lieu de
   `Greeter:`) : le regex `[Gg]reete?r` ne couvrait pas toutes les casses.
   Fix : passage en `/i` sur les deux moteurs. Découvert tardivement car
   absent des premiers plannings de test — **rester vigilant à toute
   nouvelle variante de casse/ponctuation du libellé**, c'est la zone la
   plus susceptible de changer sans prévenir.
7. **Greeters sans libellé** (`NOM +téléphone` directement, sans le mot
   "Greeter") : ajout d'un repli détectant un nom suivi d'un numéro,
   borné au porteur suivant.
8. **Référentiels codés en dur** identifiés comme dette lors d'un audit
   sécurité/architecture (cf. discussion explicite avec l'utilisateur) →
   remplacés par le mécanisme auto-alimenté (§4).
9. **Décision explicite de l'utilisateur** : la sécurité (chiffrement du
   `localStorage`, RGPD strict) n'est **pas** une priorité pour ce projet
   — usage strictement interne. Ne pas réintroduire de friction
   (chiffrement, expiration forcée des données...) sans demande explicite.
10. **Bug d'alignement copier-coller — téléphone préfixé `?`** : sur les
    clusters entièrement dumpés en colonnes (en-tête éclaté, ex. planning
    du 21/06), l'alignement par rang échouait pour tout le cluster parce
    qu'un porteur dont le numéro est rendu `?+33 6 16 14 86 00?` (Brandon
    L.) n'était pas reconnu : le test de contexte porteur (`ctxRe`)
    exigeait que la ligne suivant le nom commence par `+`/chiffre. Le `?`
    initial cassait la détection → 4 porteurs comptés au lieu de 5 →
    `coreAligned` faux → chips pour toute la grappe. Fix : `ctxRe` tolère
    désormais un `?`/espace en tête (`/^[?\s]*(\+?\d|...)/i`), aux deux
    endroits (`tokPorters` et `scrambledCluster`). Un seul caractère
    bloquait la résolution de grappes entières — **toujours tester sur un
    porteur dont le numéro a un format atypique**.
11. **Re-extraction automatique au changement de porteur** : après un
    chargement (PDF ou texte), changer la sélection de porteur relance
    l'extraction pour le nouveau porteur sans recharger le fichier. Les
    pages coordonnées du dernier PDF sont mises en cache (`lastPdfPages`)
    pour réutiliser le chemin fiable ; à défaut, repli sur le texte de
    `planningInput`. Ne se déclenche pas si aucun planning n'est encore
    chargé (pour ne pas vider l'écran à la première sélection).
12. **Téléphones cliquables** (greeter + chauffeur) : ajout de
    `greeteurPhone`/`contactPhone`, chips `tel:` dans l'UI. `phoneNorm`
    durci (commence par `+`/`0`, ≥ 9 chiffres) pour rejeter les faux
    positifs d'horodatage. `contactPhoneFrom` retiré de `parser.js` au
    profit de `enrichMissionsWithPhones` (débordement de bande Y, voir
    `src/core/CLAUDE.md`, chemin PDF).
13. **Codes vol avec espace** (`BA 328`) : `flightFromItinerary` accepte
    `[A-Za-z]{1,3}\s*\d{1,5}` et recompacte (`BA 328` → `BA328`).
14. **Faux terminal depuis horodatage** (`Terminal 19:00:00` → terminal
    `19`) : lookahead `(?![\d:])` ajouté (cas U21733, planning 24/06).
15. **Clients vides — missions agence et groupes ALL-CAPS** : le moteur
    copier-coller ne reconnaissait que ACA/Monaco/WELL'COM. Ajout de
    l'extraction `M. NOM +tel` (repli `NOM [2026-xxxxxx]`) et d'un fallback
    ALL-CAPS (`GM FINANCIAL CHILE`, `WD CONSEILS`). Pax aussi corrigé
    (recherché depuis la réf booking, pas autour du porteur).
16. **Bagages par défaut « collants »** : `emptyMission` lisait
    `defaults.bagStandard` (objet muté par `syncAll`), donc une nouvelle
    mission héritait du dernier nombre saisi. Fix : `bagStandard` hardcodé
    à `'1'`, `probleme` hardcodé à `''`. **Ne jamais relier ces champs à
    `defaults`.**
17. **Majuscules + terminal numérique** : vol/client/greeteur forcés en
    majuscules à la frappe, terminal restreint aux chiffres.
18. **Type TRS** ajouté (transit terminal à terminal) ; lieux laissés vides
    par `applyLieuDefaults` pour ce type.
19. **NO SHOW** : bouton rouge dans l'entête, préremplit N/A en gardant
    l'identité (voir §4). A nécessité l'ajout de l'option `N/A` aux
    sélecteurs lieu/satisfaction et a corrigé au passage un double
    `</select>` existant sur le champ satisfaction.
20. **Copie iOS fiabilisée** (`copyReport`) : l'ancien code affichait
    « copié ✓ » même en cas d'échec. Réécrit pour détecter le succès réel —
    `navigator.clipboard.writeText` seulement si `isSecureContext`, sinon
    fallback iOS avec `document.createRange()` + `setSelectionRange()` (le
    `.select()` seul est ignoré par Safari iOS sur un textarea hors-écran).
    Message d'échec explicite en rouge si tout échoue.
21. **Session multi-jours (3 jours glissants)** : `restoreState` jetait la
    session dès le lendemain (`state.day !== todayKey()`). Remplacé par un
    anneau `{ days: { "YYYY-MM-DD": {...} } }` conservant les 3 derniers
    jours (`pruneStore`), restaurant la session la plus récente disponible.
    Rétrocompat avec l'ancien format à plat gérée par `loadStore`.
    `clearState` n'efface plus que le jour courant.
22. **Validation avant rapport** (`validateMission`) : booking + pax requis
    partout, vol + terminal en plus pour ARR/DEP ; champs manquants en
    rouge + focus (voir §4).
23. **Bouton mission manuelle remonté** + insertion en tête de liste
    (`unshift`).
24. **Retouches rapport (v2, post-refactoring)** : trois demandes utilisateur
    distinctes traitées en petites itérations sur `src/core/report.js` et
    `src/ui/app.js` — (a) liste de base des porteurs (`index.html`) mise à
    jour avec un nouveau collègue (`Bryan L`, sans point final — attention à
    ne pas réintroduire de point, corrigé une fois par erreur) ; (b) ligne
    Booking du rapport reformatée `Booking : #xxxxx` (le `#` était avant les
    deux points, l'utilisateur le voulait après) ; (c) bouton copie 📋 sur le
    champ Vol (`copyFlight`), qui a motivé l'extraction de `writeClipboard`
    hors de `copyReport` pour éviter la duplication de la logique clipboard
    iOS ; (d) section « Un problème rencontré ? » affiche « Aucun problème »
    (singulier — corrigé une fois après une coquille « Aucun problèmes »)
    quand le champ est vide. Aucune de ces retouches ne touche
    `parser-pdf.js`/`parser-text.js` : `npm test` reste vert sans besoin de
    revalider les 4 plannings de référence (voir `src/core/CLAUDE.md`,
    Méthode de validation), la suite de tests
    suffit. Au passage, un bug d'environnement a été corrigé dans
    `tests/parser.test.js` : sous la version de Node de cet environnement,
    `import('pdfjs-dist/legacy/build/pdf.js')` n'expose plus `getDocument`
    directement sur l'espace de noms ESM (il faut lire `mod.default`) — sans
    ce fix les tests d'intégration PDF ne s'exécutaient jamais et
    l'échec passait inaperçu.
25. **Bug booking ACA erroné — double dièse `M##31309`** : sur un planning
    du 23/07, un unique M# (parmi une vingtaine sur le même PDF) était rendu
    `M##31309` (deux `#`) au lieu de `M#31309` — glitch ponctuel côté TCPDF,
    pas un nouveau format à supporter. Le regex `M#\s*(\d+)` de `mnum`
    n'autorisait aucun caractère entre `M#` et les chiffres, donc ne
    matchait pas du tout : `mnum` restait `null`, et comme `client.tok`
    valait bien `'ACA'` (la colonne Client, elle, était intacte), `isAirport`
    restait vrai — mais `booking` retombait sur `row.ref` (la réf brute
    `11483-420`) au lieu du numéro M# attendu (`31309`), un mauvais numéro
    affiché dans un rapport déjà généré (bug utilisateur signalé comme
    « erreur majeure »). Fix : `M#+\s*(\d+)` (un ou plusieurs `#`) dans les
    **quatre** occurrences du pattern (`parser-pdf.js` + trois dans
    `parser-text.js` — même piège potentiel sur le moteur copier-coller,
    jamais testé isolément mais corrigé par précaution). Fixture de
    régression ajoutée : `tests/fixtures/planning-23-double-hash.pdf`
    (porteur Damien P., vol EJU1687 → booking attendu `31309`). **Piège à
    garder en tête** : toute regex qui suppose un format figé pour un
    séparateur censé être constant (ici littéralement `#`) doit rester
    tolérante à une variation ponctuelle du rendu PDF — même leçon que le
    fix historique du `?` en tête de numéro de téléphone (point 10).
26. **Greeter sans « : » et téléphone qui déborde sur la mission voisine** :
    signalé par l'utilisateur (« des fois après Greeteur il n'y a pas de
    ":" ») sur un planning du 24/07. Investigation : le nom du greeter
    (`greeterInfoFromLines`, `greeterFromScope`) était déjà extrait
    correctement sans `:` (`[\s:,]+`/`[\s:]*` acceptent un simple espace,
    « Greeter NOM » fonctionnait déjà) — mais l'audit a révélé un vrai bug
    voisin dans `enrichWithPhones` (`src/core/enrich.js`) : quand un greeter
    labellisé (avec ou sans `:`) n'a **aucun téléphone propre** dans le
    texte, la fenêtre de recherche du numéro (200 caractères après le nom,
    non bornée) débordait sur la mission suivante et lui volait le
    téléphone du porteur voisin (cas réel : `Greeter: Antoine` sans numéro
    récupérait le `06 10 88 78 90` de `Bryan L`, la mission suivante — même
    famille de bug que le débordement historique de `contactPhone`, voir
    `src/core/CLAUDE.md`/§7). Fix : la fenêtre de `enrichWithPhones` est désormais bornée à
    200 caractères ET à la prochaine réf booking (`\d{4,6}-\d+`), le slice
    étant fait *avant* la recherche de réf pour ne jamais scanner au-delà sur
    un gros planning (8 pages / 40+ missions) — même principe que
    `contactPhone`, factorisé en une constante `BOOKING_REF_RE` partagée.
    Deux tests unitaires ajoutés sur `enrichWithPhones` (texte synthétique,
    plus robustes que des coordonnées PDF) + fixture
    `tests/fixtures/planning-24-greeter-no-colon.pdf` (Falco P., vol EY37 →
    greeteur `Louane`, extrait sans `:`). **Fausse piste corrigée en revue** :
    une première version élargissait aussi les séparateurs (`[\s:,\-–]+` /
    `[\s:\-–]*`) pour tolérer un tiret entre « Greeter » et le nom, motif
    observé ailleurs dans le même PDF (`Jean-François – +33...`) — mais ce
    cas précis n'a **pas** le mot « Greeter » du tout (fallback nom+tel sans
    libellé, non concerné), donc rien ne justifiait le changement ; pire, il
    ouvrait un risque réel (`code-review` l'a détecté) : un greeter non
    assigné rendu « Greeter - » suivi du mot de la colonne Type capturerait
    ce mot comme faux nom (ex. « Greeter - Arrivée » → greeteur `"Arrivée"`).
    Reverti dans les 4 emplacements concernés — la classe reste `[\s:,]+` /
    `[\s:]*`, jamais testée en défaut sur aucun planning réel jusqu'ici.
27. **Bagages hors format/cage « collants » (même bug que le point 16, jamais
    corrigé pour ces deux champs)** : signalé par l'utilisateur (« je mets 3
    bagages hors format → je charge un autre PDF → les 3 sont encore là sur
    les nouvelles missions »). Cause identique au point 16 : `createMission()`
    lisait `defaults.bagHorsFormat`/`defaults.bagCage` (objet mutable mis à
    jour par `syncDefaults` à chaque génération de rapport), et aucun moteur
    d'extraction (PDF ni copier-coller) ne renseigne jamais ces deux champs —
    donc une mission nouvellement extraite ou ajoutée manuellement héritait
    silencieusement du dernier compte saisi sur une mission précédente, y
    compris après un changement de porteur ou le chargement d'un PDF
    différent. Le fix du point 16 n'avait hardcodé que `bagStandard` ; jamais
    étendu à `bagHorsFormat`/`bagCage` à l'époque. Fix : les deux champs sont
    désormais hardcodés à `'0'` dans `createMission()`, comme `bagStandard`
    l'est à `'1'` — **ne jamais les relier à `defaults`** (même piège que le
    point 16, à ne pas réintroduire). À ce stade, `defaults.bagHorsFormat`/
    `bagCage` étaient laissés dans l'objet `defaults` par cohérence avec
    l'existant (même tolérance qu'alors pour `bagStandard`) — **revu au point
    28 ci-dessous, `defaults` a depuis été supprimé entièrement**. Testé et
    vérifié dans le navigateur (skill `run-rapport`) : une mission dont le
    « Hors format » est mis à 3 puis dont le rapport est généré ne contamine
    plus une mission ajoutée après — elle repart à 0.
28. **Suppression complète du mécanisme `defaults`/`syncDefaults`** : juste
    après le fix du point 27, l'utilisateur a précisé que le même problème
    devait être corrigé **« sur tous les champs, pas que ceux-là »** — pas
    seulement les bagages, mais aussi détaxe, lieu de rencontre/dépose,
    nombre de porteurs, satisfaction, pré-booking/live, qui lisaient encore
    tous `defaults.X` (l'objet mutable des « préférences glissantes »,
    volontaire à l'origine — pratique si le porteur ressaisit souvent les
    mêmes valeurs — mais l'utilisateur a tranché : il ne veut plus de ce
    comportement du tout). Plutôt que corriger champ par champ comme au point
    27 (ce qui aurait laissé le mécanisme en place pour de futurs champs et
    risqué une troisième régression du même genre), **le mécanisme entier a
    été retiré** : l'objet `defaults`, la fonction `syncDefaults()` et son
    appel dans `generateReport()` (`src/ui/app.js`) ont été supprimés.
    `createMission()` ne lit plus que des constantes fixes pour tous ses
    champs. Effet de bord positif : l'import mort `import { defaults } from
    '../core/mission.js'` en tête de `src/ui/app.js` (jamais utilisé,
    probablement un reliquat) a été nettoyé au passage. Test unitaire étendu
    pour couvrir tous les champs concernés (pas seulement les bagages) ;
    revérifié dans le navigateur (détaxe/satisfaction/porteurs modifiés sur
    une mission, rapport généré, nouvelle mission ajoutée → repart bien des
    valeurs fixes, pas de celles saisies).

---

## 7. Dette technique connue (acceptée, non traitée par choix)

Issue d'un audit explicite ; statut = décision assumée par l'utilisateur,
pas un oubli :

- **Sécurité `localStorage`** : PII en clair, pas de chiffrement, pas
  d'expiration. Accepté — usage interne uniquement.
- **Deux moteurs d'extraction parallèles** (`core/parser-pdf.js` et
  `core/parser-text.js`) : redondance partielle, risque de dérive entre les
  deux. Pas fusionnés par choix — chacun est validé indépendamment, un merge
  introduirait un risque de régression sans gain fonctionnel immédiat.
- **`parser-text.js` n'est PAS piloté par la config** : il contient encore en
  dur les tokens de clients (`ACA`, `Monaco Mediax`, `WELL'COM`), les
  libellés et une liste de villes. Le rendre config-driven imposerait de
  réécrire son heuristique de ~600 lignes (haut risque de régression) pour un
  moteur qui n'est que le repli. **Conséquence pour l'upscaling** : sur un
  nouveau site, `parser-pdf.js` fonctionne immédiatement via config ;
  `parser-text.js` nécessiterait d'adapter ses constantes. Comme le PDF est
  le chemin recommandé et fiable, c'est accepté. (Audit v2.)
- **Géométrie de colonnes codée en dur** : `defaultCenters` dans
  `config/nce-wellcom.js` est un repli ; la détection dynamique d'en-tête
  (`detectColumns`) absorbe la plupart des variations. À surveiller si TCPDF
  change radicalement de gabarit.
- **Dépendance pdf.js via CDN sans SRI** : pas de vérification d'intégrité.
- **`contactPhone` dépend du texte complet, pas des coordonnées** : depuis
  le retrait de `contactPhoneFrom` du parser PDF, le numéro chauffeur est
  extrait par `enrichWithPhones` sur le texte aplati. Fiable sur les
  plannings testés mais sensible à un changement de libellé
  (`Contact Chauffeur:`) ou de mise en page agence.

---

## 8. Upscaling vers un autre site (multi-aéroport / multi-agence)

Procédure et détails déplacés vers le skill `upscale-new-site`
(`.claude/skills/upscale-new-site/SKILL.md`) — invoqué automatiquement pour
toute demande d'ajout d'un nouveau site/aéroport/agence.

---

## 9. Direction artistique (DA Well'Com Air)

L'UI suit la DA de Well'Com Air (service VIP aéroportuaire premium). Palette
en variables CSS dans `:root` :

- `--navy #0b1b2e` / `--navy-2 #13293f` : midnight profond (fond du logo,
  en-tête, bandeau mission).
- `--gold #c8a86b` / `--gold-deep #a8884c` : or champagne, accent signature
  (filets, badges, heure dans la bannière, chips actives, focus).
- `--bg #f6f3ee` ivoire chaud, `--cream #faf5ea` pour chips/total.
- Titrage en capitales très espacées (`letter-spacing:.34em`) ; wordmark
  « WELL'COM AIR » en **Cormorant Garamond** (Google Fonts, repli Georgia)
  dans l'en-tête. Le reste de l'UI reste en sans-serif système pour la
  lisibilité des formulaires.

L'ancien `--amber` est conservé comme **alias de `--gold`** pour que toute
règle résiduelle reste cohérente. La couleur exacte du hex de marque n'était
pas extractible automatiquement (logo en image, CSS du thème non lisible) ;
la palette est calée sur l'esthétique publique de la marque (sombre + or,
logo blanc sur fond foncé). À ajuster si Damien fournit la charte exacte.

## Pour aller plus loin

Avant toute modification du parsing, relire intégralement `src/core/CLAUDE.md`
(architecture des deux moteurs, chargé automatiquement pour tout travail sous
`src/core/`) et §5 ci-dessus — la majorité des régressions passées venaient
d'une correction locale qui ignorait l'historique d'un fix précédent sur un
cas voisin. Toujours revalider sur les 4 plannings de référence avant de
livrer.
