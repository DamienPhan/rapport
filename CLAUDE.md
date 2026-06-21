# CLAUDE.md — Contexte projet « Rapports de mission »

Ce document donne à toute IA (ou développeur) reprenant ce projet le
contexte complet : qui l'utilise, pourquoi, comment c'est construit, quelles
décisions ont été prises et pourquoi, quels pièges éviter.

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

| Fichier | Rôle |
|---|---|
| `index.html` | Application complète : UI, état, rendu, génération de rapport, **moteur d'extraction copier-coller**, référentiels auto-alimentés |
| `parser.js` | **Moteur d'extraction PDF** par reconstruction de table via coordonnées spatiales (pdf.js) |
| `README.md` | Documentation utilisateur |
| `CLAUDE.md` | Ce fichier — contexte technique pour reprise |

Aucun autre fichier n'est nécessaire au déploiement. `pdf.js` est chargé
depuis un CDN dans `index.html` (`<script src="parser.js">` est inclus
juste après).

---

## 3. Architecture — les deux moteurs d'extraction

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
  villes (Naples, Sofia, London, Budapest) sont exclus.
- **Greeter** (`greeterFromLines`) : d'abord libellé explicite (insensible
  à la casse — `GREETER:`, `Greeter :`, `greeter::`...), sinon repli sur
  un nom suivi d'un téléphone sans libellé (`NOM +33...`), borné au
  porteur suivant pour ne jamais déborder sur la mission voisine.
- **Client/Booking** : ACA → `client.tok === 'ACA'`, booking = `M#xxxxx` ;
  agence → booking = référence `[2026-xxxxxx]`, client = nom de l'agence ;
  greeter vide pour les missions agence (pas de greeter, juste un
  chauffeur).

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
  booking, date, vol, terminal, type,       // ARR | DEP | Service
  client, greeteur, pax,
  prebooking,                                // PRÉ-BOOKING | LIVE
  detaxe,                                    // Oui | Non
  lieuRencontre, lieuRencontreAutre,
  lieuDepose, lieuDeposeAutre,               // 'AUTO_CHECKIN' = calculé depuis le vol
  probleme, porteurs, satisfaction,
  bagStandard, bagHorsFormat, bagCage,      // défaut '0' chacun ; hf/cage = inputs numériques libres (peut être élevé)
  sortTime,                                  // pour le tri chronologique ET l'heure affichée dans la bannière (fmtTime)
  bookingOptions, flightOptions              // peuplés uniquement si "chips"
}
```

### Règles de routage par défaut (`applyLieuDefaults`, appliqué une fois à
l'extraction, jamais réécrasé par l'undo ou l'édition manuelle)

| Type | Lieu de rencontre | Lieu de dépose |
|---|---|---|
| Arrivée (ARR) | Tapis bagage | Parking pro |
| Départ (DEP) | Dépose minute | Check-in + vol (`AUTO_CHECKIN`) |

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
- Missions « Service » (sans vol, ex. dépose simple) : type forcé à
  `Service`, vol/terminal vides.

### Conventions de saisie / rapport (décisions Damien)

- **Bagages** : `bagStandard`, `bagHorsFormat`, `bagCage` valent **0 par
  défaut**. Hors-format et cage animal sont des **inputs numériques libres**
  (il peut y en avoir beaucoup — l'ancien select 0–5/N-A était trop limité).
  Dans le rapport généré, hors-format/cage affichent **`n/a` si vide ou 0**,
  sinon le nombre ; le total = standard + hors-format + cage (valeurs nulles
  comptées comme 0).
- **Mission manuelle** (`addManualMission`) : par défaut **LIVE** avec un
  booking pré-rempli **`2026-`** (mission ajoutée le jour même, hors PDF).
- **Bannière de carte** : affiche l'heure de début à côté du booking
  (`Booking 28856 · 08:00`) via `fmtTime(sortTime)` ; rien si l'heure est
  inconnue (`sortTime` = 9999, cas des missions manuelles). `sortTime`
  survit à `syncAll` (aucun champ DOM correspondant) et est préservé au
  choix d'un chip booking (`pickBooking`).

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

---

## 6. Méthode de validation (à reproduire pour toute modification)

Il n'y a pas de suite de tests automatisée committée dans le dépôt — la
validation se fait par script ad hoc à chaque session, en comparant la
sortie du parseur à une vérité terrain extraite indépendamment du PDF
(`fitz`/PyMuPDF en Python, texte propre par bloc de mission, jamais le
même chemin de code que le parseur testé).

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

**Protocole minimal avant de livrer un changement touchant
extraction/attribution** :

1. Construire la vérité terrain (booking, vol, terminal, type, porteur,
   greeter) depuis le texte PyMuPDF propre (pas depuis le parseur).
2. Comparer la sortie de `parser.js` (chemin PDF) sur **tous les
   porteurs** du planning, pas seulement Damien P.
3. Comparer la sortie du moteur copier-coller sur le texte tel que
   l'utilisateur l'a réellement collé (pas un texte reconstruit à la
   main — le désordre exact du collage est ce qui révèle les bugs).
4. Zéro régression sur les plannings de référence précédents avant de
   livrer.

---

## 7. Dette technique connue (acceptée, non traitée par choix)

Issue d'un audit explicite ; statut = décision assumée par l'utilisateur,
pas un oubli :

- **Sécurité `localStorage`** : PII en clair, pas de chiffrement, pas
  d'expiration. Accepté — usage interne uniquement.
- **Deux moteurs d'extraction parallèles** (`parser.js` et
  `extractMissionsPdfjs`/`extractMissionsCopyPaste` dans `index.html`) :
  redondance partielle, risque de dérive entre les deux. Pas fusionnés
  par choix — chacun est validé indépendamment à 100 %, un merge
  introduirait un risque de régression sans gain fonctionnel immédiat.
- **Géométrie de colonnes codée en dur** (`DEFAULT_CENTERS` dans
  `parser.js`) : repli uniquement, la détection dynamique d'en-tête
  (`detectColumns`) absorbe la plupart des variations. À surveiller si
  TCPDF change radicalement de gabarit.
- **Dépendance pdf.js via CDN sans SRI** : pas de vérification
  d'intégrité. Accepté avec la sécurité globale.

## Pour aller plus loin

Avant toute modification du parsing, relire intégralement §3 et §5 — la
majorité des régressions passées venaient d'une correction locale qui
ignorait l'historique d'un fix précédent sur un cas voisin. Toujours
revalider sur les 4 plannings de référence avant de livrer.
