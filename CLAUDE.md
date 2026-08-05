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

**`src/i18n/`** (traduction de l'interface FR/EN, voir §5 point 29) suit la
même logique que `store/` : `lang.js` touche `localStorage`/`navigator` mais
jamais `document` ; c'est `ui/app.js` seul qui applique les traductions au
DOM. `src/core/` ne connaît RIEN de la langue de l'UI — voir §5 point 29
pour la raison (le rapport final doit toujours être en français).

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
  client, greetSign, porterNote, greeteur, greeteurPhone, contactPhone, pax,
  prebooking,                                // PRÉ-BOOKING | LIVE
  detaxe,                                    // Oui | Non | N/A
  lieuRencontre, lieuRencontreAutre,
  lieuDepose, lieuDeposeAutre,               // 'AUTO_CHECKIN' = calculé depuis le vol ; 'N/A' possible
  probleme, porteurs, satisfaction,          // satisfaction : ... | N/A
  bagStandard, bagExpected, bagHorsFormat, bagHorsFormatExpected, bagCage,  // bagStandard/bagHorsFormat défaut '1'/'0' (toujours éditables, jamais écrasés par la note — voir §5 point 33) ; bagExpected/bagHorsFormatExpected = repères lecture seule ; cage défaut '0', input numérique libre
  sortTime,                                  // pour le tri chronologique ET l'heure affichée dans la bannière (fmtTime)
  bookingOptions, flightOptions              // peuplés uniquement si "chips"
}
```

**Champs ajoutés récemment** : `greeteurPhone`, `contactPhone` (téléphones
cliquables, voir `src/core/CLAUDE.md`) ; `greetSign`/`bagExpected`/
`bagHorsFormatExpected`/`porterNote` (repères en lecture seule — panneau
d'accueil, bagages attendus selon la note et note libre au porteur, jamais
des champs éditables, voir §5 points 32-33-35). Le type accepte désormais **`TRS`** (transit terminal à
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

**Nuance depuis §5 point 32** : pour les missions agence dont la note au
porteur contient le bloc « services » structuré (voir `noteBlock.js`), le
lieu réel qui y est indiqué (Parking pro/public, Dépose-minute) **remplace**
cette valeur déterministe — c'est une donnée réelle du booking, pas une
extraction de l'itinéraire PDF, donc plus fiable que le tableau ci-dessus.
Le tableau reste le seul repli quand ce bloc est absent (immense majorité
des missions ACA classiques).

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

- **Bagages** : `bagStandard` vaut **1 par défaut**, toujours éditable par
  le porteur, **jamais** écrasé automatiquement (voir §5 point 33 —
  l'extraction ne fait jamais confiance aveuglément à la note pour un
  compte aussi important pour la facturation). `bagHorsFormat` et
  `bagCage` valent 0. Hors-format et cage animal sont des **inputs
  numériques libres** (il peut y en avoir beaucoup — l'ancien select 0–5/N-A
  était trop limité). Dans le rapport généré, hors-format/cage affichent
  **`N/A` (majuscules) si vide ou 0**, sinon le nombre ; le total = standard
  + hors-format + cage (valeurs nulles ou `N/A` comptées comme 0).
  **Repère lecture seule** (§5 point 32-33) : les missions agence dont la
  note contient le bloc « services » structuré affichent un indice
  « Attendu selon le planning : N » sous le champ Standard (`bagExpected`,
  jamais dans le rapport, jamais dans un champ éditable) — N = bagages
  inclus dans le forfait (`cfg.baggage.includedInPackage`, 4 chez Well'Com
  Air) + excédent listé séparément dans la note. Au porteur de compter et
  saisir la vraie valeur dans `bagStandard`.
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
29. **Interface bilingue FR/EN, rapport final toujours en français** :
    demande explicite de l'utilisateur (colonie de porteurs pas tous
    francophones). Trois nouveaux fichiers : `src/i18n/translations.js`
    (dictionnaires `fr`/`en`, chaînes fixes ou fonctions pour l'interpolation/
    pluriel — ex. `pdf.success({n, pages})`), `src/i18n/lang.js`
    (`detectLang()` via `navigator.languages`, `getLang()`/`setLang()` via
    `localStorage['appLang']`, `t(lang, key, vars)`, `optionLabel(lang, group,
    value)` — voir §2 pour la frontière core/store/ui respectée). Détection :
    anglais si une langue du téléphone commence par `en`, français par défaut
    sinon (équipe francophone, l'anglais est la seule alternative utile).
    Bouton de bascule (`#langToggle` dans le header, `toggleLang()` dans
    `ui/app.js`) : persiste le choix explicite dans `localStorage`, qui prime
    ensuite sur la détection à chaque rechargement.
    **Décision centrale, à ne jamais casser** : les VALEURS métier stockées
    dans une mission (`détaxe`, `lieuRencontre`/`lieuDepose`, `satisfaction`,
    `prebooking`, `type` ARR/DEP/TRS...) restent des constantes françaises
    fixes, quelle que soit la langue de l'UI — c'est ce que lisent
    `src/core/*.js` et ce qui part tel quel dans `generateReportText()`. Pour
    les `<select>` dont l'option affichée doit être traduite (détaxe, lieux,
    satisfaction, pré-booking), chaque `<option>` a désormais un attribut
    `value="…"` explicite fixé à la valeur française canonique — avant cette
    feature, ces `<option>` n'avaient pas de `value` et la valeur retombait
    implicitement sur le texte affiché ; sans cet attribut explicite, traduire
    le texte aurait silencieusement changé la valeur lue par `el.value` et
    cassé `generateReportText`/`applyPlaceDefaults`/`markNoShow`, qui
    matchent sur ces chaînes exactes. Le type ARR/DEP/TRS et les noms de
    porteurs/greeters (données propres, pas de l'UI) ne sont jamais traduits.
    Testé dans le navigateur (skill `run-rapport`) : `navigator.language`
    forcé à `en-US` par défaut dans Chromium headless → détection automatique
    en anglais confirmée sans action manuelle ; bascule EN→FR confirmée ;
    préférence explicite confirmée persistante après rechargement de page ;
    valeurs de `<select>` vérifiées inchangées (`["Non","Dépose
    minute","Excellente","LIVE"]`) malgré l'affichage anglais ; rapport généré
    en interface anglaise vérifié caractère pour caractère toujours en
    français.
30. **`/code-review` du commit i18n (point 29) — bug de perte de saisie sur
    `toggleLang()` + deux bugs de traduction mineurs** : 8 agents lancés en
    parallèle sur le commit `1da99fb`. Un bug confirmé par plusieurs angles
    (correction/comportement supprimé) : `toggleLang()` appelait `render()`
    sans `syncAll()` d'abord, contrairement à tous les autres sites d'appel
    interactifs (`removeMission`, `toggleMission`, `markNoShow`,
    `undoMissions`, `generateReport`...) — `render()` reconstruit tout le DOM
    depuis le tableau `missions` en mémoire, donc une saisie tapée mais pas
    encore blurée (ex. `probleme` en cours d'édition) était silencieusement
    perdue si l'utilisateur basculait la langue avant de sortir du champ.
    Fix : `syncAll()` ajouté en première ligne de `toggleLang()`. Deux bugs
    de traduction mineurs trouvés en parallèle : (a) l'option statique
    « Autre... » du `<select>` porteur dans `index.html` n'avait pas
    d'attribut `data-i18n`, donc restait en français au tout premier
    chargement en anglais tant qu'aucun planning n'était chargé (le
    `refreshRosterUI()` qui la traduit ne se déclenche qu'après extraction) —
    fix : `data-i18n="porter.other"` ajouté sur l'`<option>` statique ; (b)
    `detectLang()` faisait `navigator.languages || [navigator.language]`,
    qui ne se replie jamais sur `navigator.language` si `navigator.languages`
    existe mais est un tableau **vide** (`[] || x` vaut `[]`, un tableau vide
    est *truthy*) — cas réel sur certains navigateurs/webviews anti-
    fingerprinting ; fix : test explicite de `.length` avant d'utiliser
    `navigator.languages`. Un footgun latent (pas un bug actif) a aussi été
    corrigé par précaution : deux variables locales `const t` dans
    `harvestRoster()`/`pickBooking()` masquaient le helper de traduction
    module-level `t(key, vars)` — sans effet aujourd'hui (ni l'une ni
    l'autre fonction n'appelle `t()` en interne) mais un futur ajout de
    traduction dans l'une de ces fonctions aurait échoué silencieusement en
    récupérant la variable locale au lieu du helper ; renommées `line`/`time`.
    Un test unitaire ajouté (`tests/parser.test.js`) vérifie la parité des
    clés entre `translations.fr` et `translations.en` (récursif sur les
    clés-feuilles) — plusieurs agents ont signalé indépendamment l'absence de
    filet contre une dérive de clé entre les deux dictionnaires. Les
    suggestions de simplification/déduplication (clés `validation.*`
    dupliquant `field.*`, helper de rendu d'`<option>` pour factoriser le
    motif `value="X" ${selected}>${opt(...)}`) ont été **délibérément
    laissées de côté** : refactoring stylistique sans bug associé, hors
    scope d'une correction de revue. Vérifié dans le navigateur (skill
    `run-rapport`) : champ rempli sans blur → bascule de langue → valeur
    toujours présente ; option « Autre... »/« Other... » traduite dès le
    premier rendu dans les deux langues. `npm test` : 17/17 (16 + le
    nouveau test de parité).
31. **Correction du point 30 — `data-i18n="porter.other"` était du code mort,
    aucun bug réel derrière** : un second `/code-review` (lancé sur le commit
    du point 30 lui-même) a montré que le diagnostic initial était faux.
    `refreshRosterUI()` (`src/ui/app.js`, appelée en toute fin d'init juste
    après `applyStaticTranslations()`, ligne pour ligne — voir `git blame`,
    cet appel existe depuis le **30/06**, bien avant l'i18n) réécrit
    inconditionnellement et de façon synchrone tout le `innerHTML` du
    `<select>` porteur à chaque chargement de page, avec sa propre traduction
    `t('porter.other')` directement en JS — donc l'`<option>` statique
    d'`index.html` (avec ou sans `data-i18n`) est toujours remplacée avant
    que le navigateur n'ait pu peindre quoi que ce soit d'observable. Le
    « bug » décrit au point 30 ((a), première mission chargée) n'existait
    donc pas : l'attribut ajouté ne pouvait avoir strictement aucun effet.
    Fix : attribut `data-i18n` retiré (code mort trompeur pour un futur
    lecteur). Au passage, nettoyage cosmétique signalé par le même agent :
    `detectLang()` dans `src/i18n/lang.js` testait deux fois
    `typeof navigator !== 'undefined'` dans le même ternaire — hissé une
    seule fois dans une variable `nav`, comportement inchangé. **Leçon** :
    même un diagnostic de bug issu d'un `/code-review` doit être vérifié par
    une lecture réelle du code (ici l'ordre d'exécution à l'init), pas
    seulement par un test manuel en navigateur qui, par coïncidence, donnait
    déjà le bon résultat avant le fix (`refreshRosterUI()` traduisait déjà
    correctement, indépendamment de l'attribut ajouté). `npm test` : 17/17,
    inchangé.
32. **Nouveau bloc « services » dans la note au porteur (missions agence —
    réservation directe hors-ACA)** : l'utilisateur a fourni 4 plannings
    réels récents (25/26/31 juillet, 24 juillet) montrant un format de note
    beaucoup plus riche que le simple `GREETER : NOM` des missions ACA,
    généré par le système de booking pour toute mission agence :
    ```
    NOM_PORTEUR
    +33...
    Greet Sign: NOM_CLIENT (ou "null")
    Flight Class : business
    ==============================
    1 x BAGAGE STANDARD inclus dans le forfait ... dans la limite de 4 bagages...
    ------------------------------
    N x BAGAGE SUPPLÉMENTAIRE +10€/piece      (optionnel)
    ------------------------------
    1 x DÉPOSE-MINUTE / PARKING PROFESSIONNEL VTC & TAXI / PARKING PUBLIC
    ------------------------------
    1 x ASSISTANCE DÉTAXE                      (optionnel)
    ```
    Demande : extraire `Greet Sign` (nouveau champ `greetSign`, affiché sur
    le rapport en `Panneau d'accueil : NOM`, omis comme le greeteur si vide),
    le total réel de bagages (4 inclus + excédent, au lieu du repli fixe `1`),
    la détaxe prépayée (`détaxe = 'Oui'` si le libellé « ASSISTANCE DÉTAXE »
    est présent — il n'apparaît que si le client a payé), et le lieu réel
    (Parking pro/public, Dépose-minute — remplace la règle déterministe par
    type, voir §4).
    - **Module `src/core/noteBlock.js`** (nouveau, pur, partagé) :
      `parseNoteBlock(text, cfg)` lit ces 4 informations depuis un texte de
      note ; `applyNoteBlock(mission, parsed, opts)` les applique à une
      mission (respecte la convention lieuRencontre=départ/lieuDepose=arrivée
      déjà utilisée par `applyPlaceDefaults` ; `opts.onlyIfEmpty` protège
      contre l'écrasement d'une valeur déjà posée par une extraction plus
      fiable — voir plus bas).
    - **Chemin PDF (fiable, prioritaire)** : `rowToFields` dans
      `parser-pdf.js` appelle `parseNoteBlock` sur le texte de colonne Note
      **déjà borné par coordonnées** et expose le résultat brut (`noteBlock`,
      champ intermédiaire) plutôt que de l'appliquer directement — parce que
      `applyPlaceDefaults`, appelé après coup dans `src/ui/app.js`, écrase
      inconditionnellement `lieuRencontre`/`lieuDepose` selon le type ; le
      lieu réel du bloc note doit donc être réappliqué PAR-DESSUS, une fois
      `applyPlaceDefaults` passé. Nouvelle fonction `missionFromRow(r)` dans
      `src/ui/app.js` (factorisée, remplace 3 callbacks `.map()` dupliqués)
      qui fait exactement ça : defaults → overlay → lieux par type → lieu
      réel du bloc note.
    - **Chemin copier-coller (repli)** : `enrichWithNotes` (nouveau,
      `enrich.js`) applique le même `parseNoteBlock`/`applyNoteBlock` mais
      sur une fenêtre de texte aplati bornée par réf booking
      (`missionWindow`, factorisé depuis la logique déjà utilisée par
      `contactPhone`), avec `onlyIfEmpty: true` — ne doit **jamais** tourner
      après le chemin PDF (redondant et risqué, voir bug ci-dessous), câblée
      uniquement sur les résultats d'`extractMissions` (`parser-text.js`).
    - **Bug trouvé pendant la validation (bande Y insuffisante pour un bloc
      haut)** : le premier jet lisait `row.vn` (texte de colonne déjà borné
      par bande Y anchor-à-anchor) directement. Sur un cluster où deux
      missions se suivent de près et où la seconde a un bloc note très haut
      (15+ lignes), le milieu anchor-à-anchor tombe **avant** le haut visuel
      du bloc de la seconde mission — son « Greet Sign: NOM » se retrouvait
      donc attribué à tort à la mission précédente (cas réel détecté :
      « Greet Sign: Kristi » d'une mission Bounmy S attribué à la mission
      juste avant, porteur François L., sur `planning-26.pdf`). Fix : quand
      le rang porteur↔ancre est fiable (`ranked`, déjà validé pour
      l'attribution du porteur lui-même — §5 point 3), le texte du bloc
      services est borné par les **lignes de porteur détectées**
      (`porterLines[a].y` → `porterLines[a+1].y`) plutôt que par le milieu
      anchor-à-anchor — n'affecte QUE cette extraction (`row.noteBlockText`,
      nouveau champ), jamais `row.vn` (greeter/porteur existant, laissé
      intact, zéro régression sur les 5 fixtures déjà validées).
    - **Second bug trouvé (bruit `NCE` inter-colonnes)** : `noteColumns:
      [4, 5]` fusionne Véhicule+Note ; le token isolé `NCE` de la colonne
      Véhicule s'intercale parfois entre deux mots du bloc services répartis
      sur deux lignes (`N x BAGAGE\nNCE SUPPLÉMENTAIRE`), cassant le motif
      `bagSupplementaire` (cas réel : `planning-24.pdf`, Anoud Almotlag,
      « 5 x BAGAGE SUPPLÉMENTAIRE » lu comme 0 excédent → bagStandard=4 au
      lieu de 9). Même famille de bug que le fix historique
      `Terminal NCE 1` → `Terminal 1` (§5 point 2), mais sur la fusion de
      colonnes Note plutôt qu'Itinéraire. Fix : `stripSiteCode()` (factorisé
      depuis `flightFromItinerary`, même regex) appliqué aussi à
      `noteBlockText`.
    - **Validation** : `parseNoteBlock`/`applyNoteBlock` testés unitairement
      sur texte synthétique (6 tests) + un test d'intégration PDF bout-en-
      bout sur le fixture `planning-25-services-block.pdf` (nouveau,
      François L., mission AF7305 et mission Bader Alosaimi). Après la
      correction des deux bugs ci-dessus, les 4 plannings fournis par
      l'utilisateur (25/26/31/24 juillet, ~19 missions avec bloc services,
      12 porteurs) ont été comparés un par un à une lecture manuelle du texte
      PDF — 100 % de correspondance. `npm test` : 25/25 (17 + 6 nouveaux
      unitaires + 2 nouveaux tests PDF), aucune régression sur les 5
      fixtures existantes.
    - **Skill `run-rapport`** : le driver n'avait aucun moyen de tester le
      flux « Charger le PDF » (pas de commande d'upload de fichier). Ajout
      de `upload <css-sel> <path>` (`page.setInputFiles`). N'a pas pu être
      utilisé pour une vérification navigateur complète dans ce conteneur —
      `pdf.js` est chargé depuis un CDN externe (`cdnjs.cloudflare.com`),
      bloqué par la politique réseau de cet environnement (même contrainte
      que l'accès à `github.io` rencontré plus tôt) — la commande reste
      utile pour un futur environnement avec accès réseau complet. Le
      chemin PDF (extraction + rendu) a été vérifié en simulant l'upload via
      `eval` sur `#planningInput` (repli copier-coller, contourne le CDN) —
      voir aussi point 33 ci-dessous, revérifié dans le navigateur.
33. **Retouche point 32 — `greetSign` et le nombre de bagages attendu ne
    doivent pas être des champs éditables** : retour utilisateur juste après
    la livraison du point 32. Deux changements :
    - **`greetSign`** : n'est plus un `<input>` du formulaire (identité).
      Affiché comme une note en lecture seule (`.note-banner`, style
      cream/gold-deep cohérent avec `.candidates`), tout en haut du corps de
      la carte, juste après `renderCandidates` — visible dès l'ouverture,
      avant même la section Identité. `🪧 Panneau d'accueil : NOM`, omis si
      vide. `generateReportText` inchangé (lit toujours `m.greetSign`,
      jamais modifié depuis l'UI puisqu'il n'y a plus de champ pour ça).
    - **Nombre de bagages attendu** : `applyNoteBlock` n'écrit plus dans
      `bagStandard` (le champ éditable saisi par le porteur, qui reste
      TOUJOURS à sa valeur de repli `'1'` tant que le porteur ne la modifie
      pas lui-même — même philosophie que « aucune extraction ne renseigne
      jamais ce champ », voir §5 point 16, à nouveau vraie pour la valeur
      éditée). Le total du bloc note (4 inclus + excédent) est stocké à part
      dans un nouveau champ non éditable `bagExpected`, affiché comme
      indice (`.hint`, déjà utilisé ailleurs dans l'app) juste sous le champ
      Standard : « Attendu selon le planning : N ». Le porteur reste seul
      responsable de la valeur qui part dans le rapport — la note sert de
      référence pour vérifier après avoir compté les bagages, pas une
      valeur imposée silencieusement.
    Mission model : ajout de `bagExpected` (`createMission()`, repli `''`,
    jamais hérité d'une mission précédente — même garantie que tous les
    autres champs, voir §5 points 27-28). Tests unitaires et d'intégration
    PDF du point 32 mis à jour pour vérifier `bagExpected` au lieu de
    `bagStandard`, plus une assertion explicite que `bagStandard` reste à
    `'1'`. Vérifié dans le navigateur (repli copier-coller avec un extrait
    réel de `planning-25-services-block.pdf`, porteur François L., mission
    Bader Alosaimi) : la note « 🪧 Greet sign : Bader Alosaimi » s'affiche
    en haut de la carte sans champ associé, l'indice « Expected per
    schedule: 5 » apparaît sous un champ Standard resté à `1`, et le rapport
    généré affiche bien `Panneau d'accueil : Bader Alosaimi`. `npm test` :
    25/25, inchangé en nombre (tests adaptés, pas ajoutés).
34. **Retouche du point 33 — regroupement et renommage des deux notes** :
    demande utilisateur juste après la livraison du point 33. `bagExpected`
    passe de l'indice discret (`.hint`) sous le champ Standard à une
    deuxième note pleine largeur (`.note-banner`, même style que le panneau
    d'accueil) juste EN DESSOUS de la note panneau d'accueil, donc toutes
    les deux tout en haut du corps de la carte, avant même la section
    Identité — les deux se lisent d'un coup d'œil à l'ouverture, sans
    scroller jusqu'à la section Bagages. Libellés raccourcis :
    « Panneau d'accueil » → **« Panneau »**, « Attendu selon le planning »
    → **« Bagages prévus »** (clé `field.bagExpectedHint` supprimée,
    remplacée par `note.bagExpected`, symétrique à `note.greetSign`).
    Revérifié dans le navigateur dans les deux langues (repli copier-coller,
    même mission Bader Alosaimi) : FR affiche « 🪧 Panneau : Bader Alosaimi »
    puis « 🧳 Bagages prévus : 5 » l'un sous l'autre ; EN affiche
    « Sign : Bader Alosaimi » puis « Expected bags : 5 ». `npm test` : 25/25,
    inchangé.
35. **Bagage hors format dans le bloc « services » + note libre distincte du
    Greet Sign, et bug de débordement de colonne sur les noms longs** :
    l'utilisateur a fourni un 5ᵉ planning réel (04/08, `planning-04-hors-
    format-note.pdf`) montrant deux ajouts au bloc « services » (voir §5
    point 32) :
    - Une ligne `N x BAGAGE HORS FORMAT +15€/piece` — item distinct du
      bagage supplémentaire (+10€/piece, déjà géré), prix différent, jamais
      additionné au total `bagExpected`.
    - Une note libre juste **avant** `Greet Sign:` — `N bags payé (si supp
      bags = a régler avec le porteur)` — un total de confirmation
      prépayé, pas une source de vérité à reparser (peut contenir des
      instructions variables), donc capturée telle quelle plutôt que
      décomposée.
    - **Extraction** (`noteBlock.js`) : `parseNoteBlock` gagne deux champs,
      `bagHorsFormat` (regex `bagHorsFormat` dans `cfg.noteLabels`, distinct
      de `bagSupplementaire`) et `porterNote` (regex `porterPaidBagsNote`,
      capture gloutonne jusqu'à la parenthèse fermante). `applyNoteBlock`
      les pose dans deux nouveaux champs mission **non éditables** —
      `bagHorsFormatExpected` et `porterNote` — même philosophie que
      `bagExpected`/`greetSign` (§5 points 32-33) : jamais dans un champ
      éditable (`bagHorsFormat` reste au repli `'0'` saisi par le porteur).
    - **UI** (`src/ui/app.js`) : troisième `.note-banner` (`📌 Note : ...`)
      ajoutée sous les deux existantes. `bagExpectedText()` (nouveau helper)
      fusionne les deux compteurs en une seule ligne — `12 (+3 hors
      format)` / `12 (+3 oversized)` — plutôt que d'ajouter une quatrième
      note séparée, pour ne pas surcharger le haut de la carte de bannières.
      Nouvelles clés i18n `note.bagHorsFormatSuffix`/`note.porter` (fr/en).
    - **Bug de débordement de colonne trouvé pendant la validation**
      (nouvelle famille de bug — cousine du débordement Y du point 32, mais
      sur l'axe X cette fois) : un `Greet Sign` ou une `porterNote` assez
      longs (ex. « Greet Sign: Moshe Benish », « Greet Sign: Salame prince
      Bassam Omar ») voyaient leur **dernier mot tronqué** — `colOf()`
      classe chaque mot par distance au centre de colonne le plus proche
      (frontière = midpoint géométrique) ; le dernier mot d'un texte assez
      long peut retomber, de quelques pixels, au-delà de la frontière entre
      la dernière colonne note (col 5) et la colonne Type (col 6) suivante,
      et se faire alors classer à tort dans Type et exclu de la collecte du
      bloc note. Mesuré sur le PDF réel : débordement à x≈676-678, contenu
      Type légitime le plus proche (« Arrivée », « Bagage standard »...) à
      x≈703 — marge de sécurité de plus de 25px entre les deux, jamais
      chevauchante sur les échantillons mesurés. Fix : nouvelle fonction
      `isNoteCol(x, centers, noteCols, overflowMargin)` dans
      `parser-pdf.js`, utilisée à la place de `colOf() ∈ noteCols` aux
      trois points de collecte du texte note (`detectPorterLines`, `vn`,
      `noteBlockText`) — élargit la frontière col5/col6 d'une marge fixe
      (`cfg.pdfTable.noteOverflowMargin = 25`, config-driven comme le reste
      de la géométrie, voir §2/§7) sans toucher aux autres frontières de
      colonnes (Itinéraire/Véhicule notamment, jamais élargies). `vn` était
      auparavant construit depuis les buckets `cells[4]+cells[5]` déjà
      classés une fois par `colOf()` strict ; recalculé désormais par un
      filtre direct sur `words` (même schéma que `noteBlockText`) pour
      pouvoir appliquer `isNoteCol` avec la marge. **Piège à garder en
      tête** si un futur champ du bloc note est ajouté : toujours tester
      avec un nom/texte volontairement long (comme ici) plutôt qu'un cas
      court qui ne révèle jamais ce genre de débordement de quelques
      pixels — un seul mot perdu en fin de capture est facile à manquer en
      relecture rapide.
    - **Validation** : deux nouveaux tests unitaires (`enrichWithNotes`
      calcule `bagHorsFormatExpected` sans toucher `bagHorsFormat` ;
      capture `porterNote` sans affecter le `greetSign` de la mission
      voisine) + fixture PDF `planning-04-hors-format-note.pdf` committée
      (2 nouveaux tests d'intégration : Stéphane M./Moshe Benish couvrant
      bagHorsFormat+porterNote, Thomas C./« Salame prince Bassam Omar »
      dédié à la régression du nom long tronqué). `npm test` : 31/31 (25 +
      6 nouveaux), aucune régression sur les fixtures existantes. Revérifié
      dans le navigateur (repli copier-coller avec le texte réel de la
      mission Stéphane M./Moshe Benish) : les trois notes s'affichent
      empilées et complètes — « 🪧 Sign : Moshe Benish » (nom entier, pas
      tronqué à « Moshe »), « 🧳 Expected bags : 12 (+3 oversized) »,
      « 📌 Note : 15 bags payé (si supp bags = a régler avec le porteur) »
      (texte entier, pas de mot manquant).
36. **`/code-review` du commit du point 35 — 7 agents en parallèle, 5 bugs
    confirmés et corrigés** : deux passes de revue indépendantes (une
    commande locale + une équipe de sous-agents) ont convergé sur les mêmes
    constats, tous vérifiés puis corrigés :
    - **Bannière bagages masquée quand seul `bagHorsFormatExpected` est
      connu** (`src/ui/app.js`) : la bannière « Bagages prévus » n'était
      affichée que si `m.bagExpected` était non vide — si le bloc note
      contient une ligne « HORS FORMAT » mais que la ligne « BAGAGE
      STANDARD » ne matche pas (mise en page future imprévue), le hors
      format extrait restait invisible. Fix : `bagExpectedText(m)` gère
      désormais aussi le cas « hors format seul » (`+3 hors format` sans
      total devant), et la condition d'affichage se base sur son résultat
      plutôt que sur `m.bagExpected` seul.
    - **`bagExpectedText` traitait `'0'` comme vrai** (même fichier) : un
      hypothétique « 0 x BAGAGE HORS FORMAT » explicite aurait affiché
      « (+0 hors format) » au lieu d'être supprimé — `Number(...) > 0`
      plutôt qu'un simple test de vérité sur la chaîne.
    - **`markNoShow` laissait des bannières de note périmées** (`src/core/
      mission.js`) : `greetSign`/`bagExpected`/`bagHorsFormatExpected`/
      `porterNote` n'étaient pas vidés par `markNoShow`, donc une mission
      passée en NO SHOW continuait d'afficher « Bagages prévus : 12 » et
      la note du porteur alors que pax/bagages/lieux affichaient déjà tous
      N/A — trompeur pour un client qui ne s'est jamais présenté. Fix : les
      quatre champs sont désormais remis à `''` par `markNoShow` (pas de
      valeur `'N/A'` : ce sont des repères d'affichage, pas des champs de
      formulaire avec un état N/A).
    - **`porterPaidBagsNote` perdait la note faute de parenthèse fermante**
      (`src/config/nce-wellcom.js`) : le premier correctif tenté (borner par
      `\n` en l'absence de `)`) a cassé la régression réelle — la note peut
      elle-même être coupée sur deux lignes PDF (« ...si supp\nbags = a
      régler... », cas réel de `planning-04-hors-format-note.pdf`), donc
      borner par le premier `\n` tronquait la capture AVANT la parenthèse
      fermante réelle (détecté immédiatement par `npm test`, qui a régressé
      sur `planning-04-hors-format-note.pdf`). Fix définitif :
      `[\s\S]*?(?:\)|(?=greet\s*sign|={5,}))` — capture non gloutonne
      bornée par la première occurrence de `)` OU du libellé `Greet Sign`/
      séparateur `====`, jamais par un simple saut de ligne. Couvre aussi le
      second risque signalé (une parenthèse lointaine après Greet Sign, ex.
      contenu Type-column « Arrivée (jusqu'à 4 bagages inclus) », ne doit
      jamais être atteinte). Trois tests unitaires ajoutés sur
      `parseNoteBlock` directement (coupure de ligne, absence de
      parenthèse, parenthèse lointaine) — la régression du premier essai
      aurait été invisible sans le test de coupure de ligne, qui reproduit
      exactement le fixture réel.
    - **Débordement de colonne : mot compté deux fois (note ET Type) +
      logique dupliquée** (`src/core/parser-pdf.js`) : le premier jet du
      point 35 collectait `vn` via un filtre `words` séparé (`isNoteCol`)
      pendant que `cells[]` (qui alimente `row.c6`, utilisé pour la
      détection ARR/DEP) restait peuplé par `colOf()` strict — un mot dans
      la marge de débordement se retrouvait donc à la fois dans le texte
      note ET dans `cells[6]`, cassant l'invariant « un mot = une colonne »
      sans bénéfice (règression latente pour un futur mot de débordement
      qui matcherait par coïncidence `/Arriv/i`/`/D.?part/i`). Fix :
      nouvelle fonction `effectiveColOf()` (classement mutuellement
      exclusif — un mot en marge de débordement rejoint la dernière colonne
      note plutôt que Type) utilisée pour peupler `cells[]` ; `vn` redevient
      un simple `lineize` des buckets `cells[4]+cells[5]` (comme avant le
      point 35), supprimant le filtre dupliqué. `detectPorterLines` (qui
      sert à localiser les NOMS de porteur, pas le texte du bloc services)
      avait aussi été élargie par erreur au point 35 avec la même marge de
      débordement — repli intentionnel vers `colOf()` strict : un nom de
      porteur n'a jamais été observé en débordement (seuls Greet Sign/note
      libre le sont), et l'élargir risquait d'agglomérer un mot Type voisin
      sur la même ligne qu'un nom, cassant le match exact de `NAME_RE` et
      faisant potentiellement chuter `ranked` pour toute la page — un coût
      largement supérieur au bénéfice pour une fonction que le bug ne
      concernait pas.
    - **Marge de débordement non proportionnelle à la géométrie** (même
      fichier) : `noteOverflowMargin` est un pixel absolu mesuré sur NCE/
      Well'Com Air (25px). Sur un futur site à colonnes plus resserrées, la
      même valeur pourrait dépasser jusqu'au centre de la colonne Type.
      Filet de sécurité ajouté (sans changer le comportement sur la
      géométrie actuelle) : la marge effective est plafonnée au tiers de
      l'écart entre les deux centres de colonnes.
    - **Non retenu** : la suggestion de dériver `noteOverflowMargin`
      entièrement de la géométrie détectée (proportion pure plutôt que
      pixel absolu + plafond) — changement plus large, non justifié par un
      bug observé, cohérent avec d'autres constantes en pixels/caractères
      déjà présentes dans ce fichier (fenêtre `BOOKING_REF_RE` à 200/2500
      caractères, marge de 4px dans `lineize`) ; le plafond proportionnel
      suffit comme garde-fou.
    - **Validation** : 4 nouveaux tests unitaires (markNoShow vide les
      repères de note ; 3 sur `parseNoteBlock`/`porterPaidBagsNote`) +
      vérification manuelle en Node des 6 branches de `bagExpectedText`
      (non testable via `npm test` : `src/ui/app.js` touche le DOM au
      chargement du module, pas importable tel quel dans le runner de test
      Node — voir §2). `npm test` : 35/35, aucune régression sur les
      fixtures existantes (dont `planning-04-hors-format-note.pdf`, qui a
      immédiatement détecté la régression du premier correctif de
      `porterPaidBagsNote`).

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
