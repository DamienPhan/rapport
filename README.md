# Rapports de mission

Application web mono-page pour générer rapidement les rapports de mission
des porteurs de l'aéroport de Nice Côte d'Azur, à partir du planning PDF
quotidien.

🔗 **App en ligne** : https://damienphan.github.io/Rapport_missions/

## Le besoin

Chaque jour, un planning PDF liste toutes les missions (vols, clients,
greeters, types de service) toutes équipes confondues. Un porteur doit en
extraire uniquement ses propres missions et produire, pour chacune, un
rapport texte structuré (6 sections) à coller ailleurs (tablette, app
métier...).

Faire ça à la main, mission par mission, est lent et source d'erreurs.
L'app automatise l'extraction et ne laisse que la vérification/édition.

## Fonctionnement en un coup d'œil

1. Sélectionner son nom dans la liste déroulante.
2. **Charger le PDF du jour** (mode recommandé, fiable à 100 % sur les
   plannings testés) **ou coller le texte** du planning (mode de repli).
3. L'app affiche une carte par mission trouvée, pré-remplie : booking,
   vol, terminal, type (arrivée/départ), client, greeter, lieux de
   rencontre/dépose, bagages...
4. Vérifier/corriger si besoin, puis générer le rapport de chaque mission
   (bouton sur la carte) pour le copier ailleurs.

Une fois un planning chargé, **changer de porteur dans la liste recharge
automatiquement ses missions** — pas besoin de recharger le fichier.

### Deux moteurs d'extraction

| Mode | Méthode | Fiabilité |
|---|---|---|
| **Charger le PDF** | reconstruction de la table par coordonnées spatiales (x, y) via pdf.js (`parser.js`) | validée à 100 % sur tous les plannings testés, y compris les plus éclatés |
| **Coller le texte** | heuristiques sur texte aplati, découpage par référence booking (`index.html`) | sûr (jamais de valeur fausse affichée comme certaine) mais peut tomber en saisie manuelle ("chips") sur les blocs vraiment ambigus |

Principe non négociable des deux moteurs : **ne jamais afficher une valeur
incertaine comme si elle était sûre**. En cas d'ambiguïté réelle (vol
dupliqué entre deux missions différentes, nom de porteur détaché de sa
référence par le collage...), l'app demande une sélection manuelle plutôt
que de deviner.

### Règles métier encodées

- **Client** : ACA (Aéroport Nice Côte d'Azur) → booking affiché sous forme
  `M#xxxxx` ; agences diverses → référence `[2026-xxxxxx]` ; Monaco Mediax,
  WELL'COM AIR reconnus spécifiquement.
- **Type de service** : Arrivée / Départ / Service (sans vol).
- **Lieux par défaut** (appliqués une fois à l'extraction, modifiables
  ensuite) :
  - Arrivée → rencontre **Tapis bagage**, dépose **Parking pro**
  - Départ → rencontre **Dépose minute**, dépose **Check-in + vol**
- **Greeter** : détecté avec ou sans libellé explicite (`Greeter:`,
  `GREETER :`, ou simplement `NOM +téléphone` juste après le porteur).

### Référentiels auto-alimentés

La liste des porteurs et des greeters n'est pas figée dans le code : chaque
planning chargé (PDF ou texte) est analysé pour en extraire automatiquement
les nouveaux noms, qui sont mémorisés localement (`localStorage`) et
réinjectés dans les listes déroulantes / l'autocomplétion. Un nouveau
collègue ou un nouveau greeter apparaît donc sans mise à jour du code.

### Persistance locale

- Sauvegarde automatique de la session du jour (anti-perte si l'onglet se
  ferme, notamment sur iOS).
- Annulation (undo) jusqu'à 20 niveaux.
- Pas de backend : tout reste dans le navigateur de l'appareil utilisé.

## Limites connues

- **Missions LIVE** (ajoutées le jour même, absentes du PDF du matin) :
  saisie manuelle, hors périmètre de l'extraction automatique.
- Le mode copier-coller peut tomber en saisie manuelle sur des blocs où la
  mise en page a réellement détruit l'association ligne ↔ mission ; charger
  le PDF directement résout ces cas.

## Déploiement

Application statique, aucun build. Pour mettre à jour le site :

1. Remplacer `index.html` et/ou `parser.js` à la racine du dépôt
   `damienphan/Rapport_missions`.
2. GitHub Pages republie automatiquement.

Dépendance externe : [pdf.js](https://mozilla.github.io/pdf.js/) chargé
depuis un CDN (pas de build, pas d'installation).

## Pour aller plus loin

Voir [`CLAUDE.md`](./CLAUDE.md) pour le contexte technique complet
(architecture détaillée, géométrie du parsing PDF, historique des
décisions, pièges connus) — destiné à toute IA ou développeur reprenant
le projet.
