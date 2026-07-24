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

```
index.html                  Coquille : structure + <link> CSS + <script type=module>
src/
├── config/nce-wellcom.js   ⭐ TOUTE la spécificité du site (clé de l'upscaling)
├── core/                   Logique métier PURE (zéro DOM)
│   ├── parser-pdf.js        Extraction PDF par coordonnées (moteur principal)
│   ├── parser-text.js       Extraction copier-coller (moteur de repli)
│   ├── phone.js             normalizePhone, extractClientPhone
│   ├── mission.js           createMission, applyPlaceDefaults, markNoShow, validateMission…
│   ├── report.js            generateReportText, resolvePlace
│   └── enrich.js            enrichWithPhones (greeter/chauffeur depuis texte complet)
├── store/session.js        Persistance localStorage abstraite (createSessionStore)
├── ui/app.js               SEULE couche DOM : rendu, événements, handlers exposés sur window
└── styles/main.css         Styles (DA Well'Com Air)
tests/
├── parser.test.js          Tests unitaires (core) + intégration (PDF de référence)
└── fixtures/*.pdf          Plannings de référence
package.json                scripts : `npm test`, `npm run serve`
```

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

## 3. Architecture — les deux moteurs d'extraction

> **Note de nommage (refactoring v2).** Les sections 3 à 5 décrivent la
> *logique* d'extraction, inchangée par le passage en modules. Les anciens
> noms y subsistent ; correspondance :
> `parser.js` → `src/core/parser-pdf.js` · `MissionParser.fromPages()` →
> `missionsForPorter(pages, porter, cfg)` · `emptyMission()` →
> `createMission()` · `applyLieuDefaults()` → `applyPlaceDefaults(m, cfg.places)` ·
> `enrichMissionsWithPhones()` → `enrichWithPhones(missions, text, cfg)` ·
> `saveDefaults()` → `syncDefaults()` · le moteur copier-coller (jadis dans
> `index.html`) → `src/core/parser-text.js`. Toutes les valeurs jadis en dur
> dans le parser PDF vivent maintenant dans `src/config/nce-wellcom.js`.

C'est le cœur du projet et la source de la quasi-totalité des itérations
passées. Il y a **deux chemins d'ingestion totalement indépendants**, avec
un objectif commun : ne jamais afficher une valeur incertaine comme si elle
était sûre.

### 3.1 Chemin PDF (`parser.js`) — recommandé, fiable à 100 %

**Constat de départ qui a motivé sa création** : le chemin texte
(copier-coller) aplatit la table PDF en lignes de texte séquentielles, ce
qui détruit l'association ligne ↔ mission dès que la mise en page TCPDF
dispose deux missions en colonnes adjacentes (cas fréquent en fin de
journée, ou pour les missions agences hors-ACA). Aucune heuristique
texte ne peut récupérer cette information de façon fiable — elle est
physiquement perdue à l'aplatissement.

**Solution** : ne jamais aplatir. pdf.js expose pour chaque PDF les
coordonnées `(x, y)` de chaque fragment de texte (`getTextContent()`).
`parser.js` reconstruit directement la table à partir de ces coordonnées.

**Géométrie de la table (mesurée sur les PDF réels, page ≈ 841pt large)** :

```
Col 0  Mission (booking ref + M#)        x ≈ 41
Col 1  Date/Heures                       x ≈ 88
Col 2  Client/Passagers                  x ≈ 174
Col 3  Itinéraire                        x ≈ 376
Col 4  Véhicule (NCE + porteur + tel)    x ≈ 538
Col 5  Note au porteur (greeter)         x ≈ 622
Col 6  Type de services                  x ≈ 716
```

Ces valeurs (`DEFAULT_CENTERS`) servent de repli ; en pratique
`detectColumns()` les recalibre dynamiquement en repérant les mots de
l'en-tête (`Mission`, `Date/Heures`, `Client`...) sur chaque page, ce qui
absorbe les petites variations de mise en page entre PDF.

**Algorithme** (`reconstructPage`) :

1. **Ancres** : tous les tokens en colonne 0 qui matchent une référence
   booking (`^\d{4,6}-\d+$`), triés par Y croissant. Chaque ancre = une
   mission.
2. **Bandes de lignes** : la page est découpée en bandes Y, une par
   ancre, bornée par le midpoint avec l'ancre voisine. La première bande
   commence au bas de l'en-tête (et non à `ancre - marge`), ce qui est
   nécessaire car le nom du porteur d'une mission agence peut être très
   au-dessus de sa réf booking.
3. **Cellules** : chaque token de la bande est assigné à une colonne via
   `colOf(x, centers)` (le x le plus proche).
4. **Itinéraire** : colonnes 3+4 fusionnées en ordre de lecture (y, x) —
   nécessaire car le mot « Terminal » dérive parfois en colonne 4 alors
   que son numéro retombe en colonne 3 à la ligne suivante.
5. **Attribution du porteur par rang (clé du fix anti-mauvaise
   attribution)** : sur les missions agence (hors ACA), le nom du porteur
   est positionné ~100px **au-dessus** de sa réf booking et peut tomber
   dans la bande Y de la mission précédente. Le simple bandage horizontal
   échoue alors (la bande précédente se retrouve réclamée par deux
   porteurs). Solution : `detectPorterLines()` liste tous les noms de
   porteur de la page (restreint aux colonnes Véhicule+Note, **colonne 6
   Type exclue** — sinon « Arrivée » se colle au nom et casse le
   pattern), triés par Y. S'il y a exactement autant de noms que
   d'ancres, on aligne le k-ième nom au k-ième ancrage (`ranked = true`,
   fiable car positionnel). Sinon repli sur l'extraction par bande
   (`porterFromLines`).

**Champs extraits et leurs pièges connus** :

- **Vol** (`flightFromItinerary`) : `N°\s*Vol\s*([A-Za-z0-9]{2,7})`.
  Avant matching, le token isolé `NCE` (bruit de la colonne Véhicule
  fusionnée) est retiré de l'itinéraire — sinon `Terminal NCE 1` casse le
  parsing du numéro de terminal.
- **Terminal** : cherché *après* le vol dans l'itinéraire (pour éviter de
  capturer un faux terminal dans le segment de prise en charge avant le
  vol). Doit être `\d{1,2}` ou une lettre seule (`B`) ; les noms de
  villes (Naples, Sofia, London, Budapest) sont exclus. **Lookahead
  `(?![\d:])` ajouté** pour ne pas capturer un horodatage comme terminal
  (`Terminal 19:00:00` ne doit pas donner terminal `19` — cas du vol
  U21733 sur le planning du 24/06).
- **Greeter** (`greeterInfoFromLines`, anciennement `greeterFromLines`) :
  retourne désormais un objet `{name, phone}`. D'abord libellé explicite
  (insensible à la casse — `GREETER:`, `Greeter :`, `greeter::`...), sinon
  repli sur un nom suivi d'un téléphone sans libellé (`NOM +33...`), borné
  au porteur suivant pour ne jamais déborder sur la mission voisine. Le
  téléphone du greeter est extrait inline ou sur la ligne suivante.
- **Téléphones** (`phoneNorm`, `contactPhoneFrom`, et
  `enrichMissionsWithPhones` côté `index.html`) : trois numéros peuvent
  apparaître par mission — le greeter (`greeteurPhone`) et le chauffeur
  (`contactPhone`, libellé `Contact Chauffeur:` sur les missions agence).
  `phoneNorm` exige un numéro commençant par `+` ou `0` et ≥ 9 chiffres
  (rejette les faux positifs issus d'horodatages, ex. `20486466` formé par
  la fusion `14:20` + `48 64 66`). **Décision importante** :
  `contactPhoneFrom` a été **retiré de `rowToFields` dans `parser.js`** car
  la note « Contact Chauffeur » déborde fréquemment de la bande Y vers la
  mission voisine (faux positif Nathan D héritant du numéro de Bastien D
  sur le 24/06). Les contacts sont désormais extraits **exclusivement** par
  `enrichMissionsWithPhones` côté `index.html`, depuis le texte complet
  avec une fenêtre bornée au prochain booking (et un saut du numéro de
  planification qui suit immédiatement la réf agence). Les numéros
  fragmentés sur deux lignes (`+33 6 47\n48 64 66`) sont gérés en aplatissant
  ~200 caractères après le libellé.
- **Client/Booking** : ACA → `client.tok === 'ACA'`, booking = `M#xxxxx` ;
  agence → booking = référence `[2026-xxxxxx]`, client = nom du client
  (extrait via `M. NOM +téléphone`, pattern le plus fiable, avec repli sur
  `NOM [2026-xxxxxx]`) ; greeter vide pour les missions agence (pas de
  greeter, juste un chauffeur). **Clients groupe ALL-CAPS** (ex.
  `GM FINANCIAL CHILE`, `WD CONSEILS`) reconnus par un fallback regex
  `^[A-Z][A-Z0-9\s'.&-]{3,}[A-Z0-9]` avec `tok = 'OTHER'` (greeter extrait
  normalement, contrairement aux missions agence).
- **Pax** : recherché via `(N)` à partir de la position de la réf booking
  dans le texte complet (jamais autour de la position du porteur, qui
  capturerait le `(N)` de la mission précédente).

**Validation empirique** : testé sur 4 plannings réels distincts
(19/06, 20/06 x2, 21/06), **toujours 100 % des missions exactes** sur
booking/vol/terminal/type/porteur/greeter, y compris les plannings où le
premier cluster est massivement éclaté en colonnes.

### 3.2 Chemin copier-coller (dans `index.html`) — repli, sûr mais parfois en saisie manuelle

Utilisé quand l'utilisateur colle le texte du planning au lieu de charger
le PDF (en pratique le mode le plus utilisé au quotidien). Le texte est
**déjà aplati** au moment où l'app le reçoit — c'est un repli pur texte,
sans accès aux coordonnées.

**Principe de sûreté central** : une mission n'est affichée avec des
valeurs *certaines* ("clean", zéro chip) que si elle est **localement non
ambiguë**. Sinon, l'app affiche des puces ("chips") pour sélection
manuelle — jamais de valeur devinée.

**Définition de « clean » (évolution importante, voir §5)** : la propreté
est jugée **localement, mission par mission** — entre la réf booking d'une
mission et la réf booking suivante (le « scope »), il doit y avoir :

- exactement **une seule réf booking** dans le scope ;
- exactement **un seul vol distinct** dans le scope (les doublons
  identiques d'un même vol comptent pour un, car une mission garde
  toujours sa propre ligne de vol — un doublon ne peut être que la ligne
  d'un voisin de même vol qui a été aspirée par le collage) ;
- **aucun autre nom de porteur** entre la réf booking candidate et le nom
  du porteur recherché (garde anti-vol-d'attribution, voir §5).

Si une de ces conditions échoue → la mission part en chips
(`bookingOptions`/`flightOptions` peuplés pour sélection manuelle dans
l'UI).

**Pourquoi pas un jugement de propreté au niveau du cluster entier** :
l'implémentation initiale désactivait le fast-path pour *tout* le cluster
dès qu'un seul sous-bloc était scrambled. Ça produisait des chips sur des
missions pourtant parfaitement claires individuellement (cas réel :
10743-138 transformé en chips alors que son booking+vol étaient sans
ambiguïté, uniquement parce qu'une mission voisine du même cluster avait
un vol dupliqué). Le jugement local par mission corrige ça sans rouvrir de
faux positifs (voir tests §6).

**Architecture interne** : trois branches de matching coexistent dans
`extractMissionsCopyPaste` (clean fast-path / alignement par rang
"coreAligned" / repli large par fenêtre de scope), routées selon le degré
de désordre détecté dans le texte. Ne pas chercher à les fusionner sans
retester les 4 plannings de référence (§6) — c'est une zone fragile qui a
déjà régressé plusieurs fois pendant le développement.

### 3.3 Routage entre les deux moteurs

`extractMissions(text, porterName)` (dans `index.html`) :

1. Si le texte ressemble à une sérialisation pdf.js déjà collée
   (`isPdfjsSerialization`), tente `extractMissionsPdfjs` (variante
   inline, différente de `parser.js` — historique, voir §7).
2. Sinon (cas normal du copier-coller), utilise
   `extractMissionsCopyPaste`.
3. Le bouton « Charger un PDF » n'utilise **pas** cette fonction : il
   appelle directement `MissionParser.fromPages()` de `parser.js`. S'il
   ne trouve aucune mission (PDF non standard, scan image...), repli sur
   `extractMissions(fullText, porter)` avec le texte aplati extrait du
   PDF.

---

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
cliquables, §3.1). Le type accepte désormais **`TRS`** (transit terminal à
terminal) en plus de ARR/DEP/Service.

**Défauts hardcodés dans `emptyMission()`, PAS hérités de `defaults`** :
`bagStandard` vaut **`'1'`** et `probleme` vaut **`''`**. C'est volontaire —
`defaults` est un objet mutable que `syncAll` met à jour avec la dernière
saisie ; si ces champs lisaient `defaults`, chaque nouvelle mission extraite
hériterait de la valeur de la mission précédente (bug réel signalé : « le
nombre de bagages garde le dernier qu'on avait mis »). Les missions extraites
du PDF n'indiquent jamais le nombre de bagages réel, d'où le défaut à 1.

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
  autre chose (ex. `'NO SHOW'`).
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
   horizontal pur (voir §3.1 point 5).
4. **Faux positif « cluster scrambled » sur le copier-coller** : une
   mission individuellement claire était mise en chips uniquement parce
   qu'un voisin de son cluster était ambigu. Fix : jugement de propreté
   local par mission (booking → booking suivant), pas par cluster (voir
   §3.2). Question légitime posée et vérifiée à l'époque : « deux
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
    §3.1).
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
    revalider les 4 plannings de référence (voir §6), la suite de tests
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
    §3.1/§7). Fix : la fenêtre de `enrichWithPhones` est désormais bornée à
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

---

## 6. Méthode de validation (à reproduire pour toute modification)

**Depuis la v2, une suite de tests est committée** : `tests/parser.test.js`,
lancée par `npm test`. Elle combine des tests unitaires sur le core pur
(téléphone, validation, NO SHOW, rapport, lieux) et des tests d'intégration
sur les PDF de référence dans `tests/fixtures/`. À lancer après CHAQUE
changement touchant `src/core/parser-*.js`, `src/config/` ou `enrich.js`.

Pour une validation plus poussée (nouveau cas litigieux), garder le réflexe
historique : comparer la sortie du parseur à une vérité terrain extraite
indépendamment du PDF (`fitz`/PyMuPDF en Python, texte propre par bloc de
mission, jamais le même chemin de code que le parseur testé).

**Plannings de référence utilisés jusqu'ici** (à demander à l'utilisateur
s'ils ne sont plus disponibles, ne pas réinventer une vérité terrain sans
PDF source) :

- `Mission-2026-06-19_10_16.pdf` — 42 missions
- `Mission-2026-06-20_06_25.pdf` — 40 missions, contient le cas
  d'attribution croisée (10656-3 / Bounmy S vs Damien P.)
- `Mission-2026-06-19_20_06.pdf` — 38 missions
- `Mission-2026-06-20_19_49.pdf` (21/06) — planning le plus éclaté
  testé, valide le fix d'alignement par rang sur un grand nombre de
  porteurs
- `Mission-2026-06-22_22_11.pdf` (23/06) — 6 pages, contient `BA 328`
  (vol à espace), Monaco Prestige Limousines, SP Hinduja Bank (clients
  agence), valide l'extraction client/pax/contact agence. **Fixture de test.**
- `Mission-2026-06-23_22_02.pdf` (24/06) — 8 pages, contient
  `GM FINANCIAL CHILE` / `WD CONSEILS` (groupes ALL-CAPS), U21733
  (`Terminal 19:00:00` piège terminal), greeter Antoine au numéro
  fragmenté sur 2 lignes, faux positif contact Nathan D.
- `planning-30.pdf` (30/06) — contient `MY FRENCH RIVIERA` et `G-OPS`
  (téléphone client dans la colonne client). **Fixture de test.**
- `planning-23-double-hash.pdf` (23/07) — contient `M##31309` (double dièse,
  glitch TCPDF ponctuel), valide le fix du regex `mnum` (booking ACA erroné,
  voir §5 point 25). **Fixture de test.**
- `planning-24-greeter-no-colon.pdf` (24/07) — contient plusieurs greeters
  labellisés sans `:` (« Greeter NOM ») et un greeter sans téléphone propre
  (Antoine), valide le fix de débordement de `enrichWithPhones` (voir §5
  point 26). **Fixture de test.**

**Protocole minimal avant de livrer un changement touchant
extraction/attribution** :

1. `npm test` doit passer au vert.
2. Si le changement touche la logique, construire la vérité terrain depuis
   le texte PyMuPDF propre (pas depuis le parseur) et comparer la sortie de
   `parser-pdf.js` sur **tous les porteurs**, pas seulement Damien P.
3. Comparer le moteur copier-coller sur le texte tel que l'utilisateur l'a
   réellement collé (le désordre exact du collage révèle les bugs).
4. Lors du refactoring v2, la non-régression a été prouvée en comparant
   octet par octet la sortie du nouveau `parser-pdf.js` à l'ancien
   `parser.js` : **51 comparaisons (porteur×fichier), 0 différence**.

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

**Objectif de l'architecture v2** : pouvoir brancher un autre site ayant le
**même format de tableau PDF** en éditant un seul fichier de config, sans
toucher au code métier.

**Procédure** :
1. Copier `src/config/nce-wellcom.js` → `src/config/<site>.js`.
2. Ajuster les valeurs : `site` (code aéroport, libellés), `pdfTable`
   (en-têtes de colonnes, centres de repli, index des colonnes), `clients`
   (motifs directs + libellés, motif de réf agence, motif groupes MAJUSCULES),
   `noteLabels` (greeter, chauffeur), `itinerary` (motif vol/terminal),
   `places` (règles ARR/DEP/TRS), `phone`.
3. Dans `src/ui/app.js`, changer l'import :
   `import { siteConfig as CFG } from '../config/<site>.js';`
4. (Si le moteur texte est nécessaire) adapter les constantes en dur de
   `parser-text.js` — voir dette §7.
5. `npm test` avec une fixture du nouveau site.

**Ce qui rend cela possible** : `core/parser-pdf.js` ne contient AUCUNE
valeur propre à un site (vérifié à l'audit v2 : 0 littéral NCE/ACA/Well'Com).
Tout passe par le paramètre `cfg`.

**Passage natif (futur)** : `core/` et `store/` étant purs (aucun DOM), une
app Capacitor ou React Native réutilise ces modules tels quels et ne réécrit
que `ui/app.js`. C'est la raison d'être de la frontière core/ui (voir §2).

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

Avant toute modification du parsing, relire intégralement §3 et §5 — la
majorité des régressions passées venaient d'une correction locale qui
ignorait l'historique d'un fix précédent sur un cas voisin. Toujours
revalider sur les 4 plannings de référence avant de livrer.
