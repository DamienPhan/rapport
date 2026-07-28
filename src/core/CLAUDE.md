# CLAUDE.md — `src/core/` (moteurs d'extraction et logique métier pure)

> Chargé automatiquement quand une session travaille sur des fichiers sous
> `src/core/` ou `src/config/`. Le contexte projet complet (qui/quoi/pourquoi,
> modèle de données, historique des bugs, dette technique) est dans le
> `CLAUDE.md` à la racine du dépôt — le lire aussi avant toute modification
> touchant l'extraction, en particulier sa section « Décisions et corrections
> historiques » : la quasi-totalité des régressions passées venaient d'une
> correction locale qui ignorait l'historique d'un fix précédent sur un cas
> voisin.

## Architecture — les deux moteurs d'extraction

> **Note de nommage (refactoring v2).** Cette section décrit la *logique*
> d'extraction, inchangée par le passage en modules. Les anciens noms y
> subsistent ; correspondance :
> `parser.js` → `src/core/parser-pdf.js` · `MissionParser.fromPages()` →
> `missionsForPorter(pages, porter, cfg)` · `emptyMission()` →
> `createMission()` · `applyLieuDefaults()` → `applyPlaceDefaults(m, cfg.places)` ·
> `enrichMissionsWithPhones()` → `enrichWithPhones(missions, text, cfg)` ·
> `saveDefaults()` → `syncDefaults()` (mécanisme depuis **supprimé**, voir
> CLAUDE.md racine §5 points 27-28) · le moteur copier-coller (jadis dans
> `index.html`) → `src/core/parser-text.js`. Toutes les valeurs jadis en dur
> dans le parser PDF vivent maintenant dans `src/config/nce-wellcom.js`.

C'est le cœur du projet et la source de la quasi-totalité des itérations
passées. Il y a **deux chemins d'ingestion totalement indépendants**, avec
un objectif commun : ne jamais afficher une valeur incertaine comme si elle
était sûre.

### Chemin PDF (`parser-pdf.js`) — recommandé, fiable à 100 %

**Constat de départ qui a motivé sa création** : le chemin texte
(copier-coller) aplatit la table PDF en lignes de texte séquentielles, ce
qui détruit l'association ligne ↔ mission dès que la mise en page TCPDF
dispose deux missions en colonnes adjacentes (cas fréquent en fin de
journée, ou pour les missions agences hors-ACA). Aucune heuristique
texte ne peut récupérer cette information de façon fiable — elle est
physiquement perdue à l'aplatissement.

**Solution** : ne jamais aplatir. pdf.js expose pour chaque PDF les
coordonnées `(x, y)` de chaque fragment de texte (`getTextContent()`).
`parser-pdf.js` reconstruit directement la table à partir de ces coordonnées.

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
  `enrichWithPhones` dans `src/core/enrich.js`) : trois numéros peuvent
  apparaître par mission — le greeter (`greeteurPhone`) et le chauffeur
  (`contactPhone`, libellé `Contact Chauffeur:` sur les missions agence).
  `phoneNorm` exige un numéro commençant par `+` ou `0` et ≥ 9 chiffres
  (rejette les faux positifs issus d'horodatages, ex. `20486466` formé par
  la fusion `14:20` + `48 64 66`). **Décision importante** :
  `contactPhoneFrom` a été **retiré de `rowToFields` dans `parser-pdf.js`**
  car la note « Contact Chauffeur » déborde fréquemment de la bande Y vers
  la mission voisine (faux positif Nathan D héritant du numéro de Bastien D
  sur le 24/06). Les contacts sont désormais extraits **exclusivement** par
  `enrichWithPhones`, depuis le texte complet avec une fenêtre bornée au
  prochain booking (et un saut du numéro de planification qui suit
  immédiatement la réf agence). Les numéros fragmentés sur deux lignes
  (`+33 6 47\n48 64 66`) sont gérés en aplatissant ~200 caractères après le
  libellé.
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

### Chemin copier-coller (`parser-text.js`) — repli, sûr mais parfois en saisie manuelle

Utilisé quand l'utilisateur colle le texte du planning au lieu de charger
le PDF (en pratique le mode le plus utilisé au quotidien). Le texte est
**déjà aplati** au moment où l'app le reçoit — c'est un repli pur texte,
sans accès aux coordonnées.

**Principe de sûreté central** : une mission n'est affichée avec des
valeurs *certaines* ("clean", zéro chip) que si elle est **localement non
ambiguë**. Sinon, l'app affiche des puces ("chips") pour sélection
manuelle — jamais de valeur devinée.

**Définition de « clean » (évolution importante, voir CLAUDE.md racine §5)** :
la propreté est jugée **localement, mission par mission** — entre la réf
booking d'une mission et la réf booking suivante (le « scope »), il doit y
avoir :

- exactement **une seule réf booking** dans le scope ;
- exactement **un seul vol distinct** dans le scope (les doublons
  identiques d'un même vol comptent pour un, car une mission garde
  toujours sa propre ligne de vol — un doublon ne peut être que la ligne
  d'un voisin de même vol qui a été aspirée par le collage) ;
- **aucun autre nom de porteur** entre la réf booking candidate et le nom
  du porteur recherché (garde anti-vol-d'attribution, voir CLAUDE.md
  racine §5).

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
faux positifs (voir tests, section Méthode de validation ci-dessous).

**Architecture interne** : trois branches de matching coexistent dans
`extractMissionsCopyPaste` (clean fast-path / alignement par rang
"coreAligned" / repli large par fenêtre de scope), routées selon le degré
de désordre détecté dans le texte. Ne pas chercher à les fusionner sans
retester les 4 plannings de référence (section Méthode de validation) —
c'est une zone fragile qui a déjà régressé plusieurs fois pendant le
développement.

### Routage entre les deux moteurs

`extractMissions(text, porterName, cfg)` (`src/core/parser-text.js`) :

1. Si le texte ressemble à une sérialisation pdf.js déjà collée
   (`isPdfjsSerialization`), tente `extractMissionsPdfjs` (variante
   inline, différente du chemin PDF principal — historique, voir CLAUDE.md
   racine §7 « Dette technique »).
2. Sinon (cas normal du copier-coller), utilise
   `extractMissionsCopyPaste`.
3. Le bouton « Charger un PDF » dans `src/ui/app.js` n'utilise **pas**
   cette fonction : il appelle directement `missionsForPorter()` de
   `parser-pdf.js`. S'il ne trouve aucune mission (PDF non standard, scan
   image...), repli sur `extractMissions(fullText, porter, cfg)` avec le
   texte aplati extrait du PDF.

## Méthode de validation (à reproduire pour toute modification)

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
  voir CLAUDE.md racine §5 point 25). **Fixture de test.**
- `planning-24-greeter-no-colon.pdf` (24/07) — contient plusieurs greeters
  labellisés sans `:` (« Greeter NOM ») et un greeter sans téléphone propre
  (Antoine), valide le fix de débordement de `enrichWithPhones` (voir
  CLAUDE.md racine §5 point 26). **Fixture de test.**

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
