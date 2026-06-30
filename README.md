# Rapports de mission

Générateur de rapports de mission pour porteurs d'aéroport. Extraction
automatique des missions depuis le PDF de planning (ou le texte collé),
saisie assistée, génération du rapport texte prêt à copier.

Application **statique, zéro build** : ouvrable en double-clic ou servie
telle quelle sur GitHub Pages. Architecture modulaire (ES modules natifs)
conçue pour être réutilisée sur d'autres sites et migrée vers une app
native (Capacitor / React Native) sans réécrire la logique métier.

## Démarrage

```bash
# Servir localement (les modules ES exigent http://, pas file://)
npm run serve        # puis http://localhost:8080
# ou
python3 -m http.server 8080
```

> Ouvrir `index.html` directement en `file://` ne fonctionne pas à cause des
> restrictions CORS sur les modules ES. Utiliser un petit serveur HTTP.

## Tests

```bash
npm install          # installe pdfjs-dist (tests PDF)
npm test             # lance tests/parser.test.js
```

Les tests couvrent le core pur (téléphone, validation, NO SHOW, rapport) et
l'intégration sur les PDF de référence (`tests/fixtures/`). À lancer après
toute modification de `src/core/parser-*.js` ou de la config.

## Architecture

```
src/
├── config/nce-wellcom.js   ⭐ Toute la spécificité du site (voir Upscaling)
├── core/                   Logique métier PURE (aucun DOM) — réutilisable natif
│   ├── parser-pdf.js        Extraction PDF par coordonnées (moteur principal)
│   ├── parser-text.js       Extraction copier-coller (moteur de repli)
│   ├── phone.js             Normalisation / extraction de téléphones
│   ├── mission.js           Modèle de mission + règles métier
│   ├── report.js            Génération du rapport texte
│   └── enrich.js            Renseignement des téléphones depuis le texte complet
├── store/session.js        Persistance (localStorage, abstraite)
├── ui/app.js               SEULE couche touchant le DOM (orchestration, rendu)
└── styles/main.css         Styles
```

**Principe directeur** : `core/` et `store/` ne touchent jamais au DOM. Le
jour du passage natif, seul `ui/app.js` est réécrit ; tout le reste est
conservé tel quel.

## Upscaling vers un autre site

Le PDF d'un autre aéroport / d'une autre agence ayant la **même structure de
tableau** se branche en éditant un seul fichier :

1. Copier `src/config/nce-wellcom.js` → `src/config/<nouveau-site>.js`
2. Ajuster : code aéroport, en-têtes de colonnes, centres de repli, motifs
   de clients, libellés de note (greeter / chauffeur), règles de lieu.
3. Dans `src/ui/app.js`, pointer l'import de config vers le nouveau fichier.

Le moteur PDF (`parser-pdf.js`) est **entièrement piloté par la config** :
aucune valeur propre à un site n'y figure.

⚠️ **Limite connue** : le moteur de repli `parser-text.js` contient encore
des libellés de clients et une liste de villes en dur (héritage de son
heuristique). Pour un nouveau site, le moteur PDF fonctionne immédiatement ;
le moteur texte nécessiterait une adaptation de ses constantes. Comme le PDF
est le chemin recommandé et fiable, cette limite est acceptée.

## Déploiement (GitHub Pages)

Pousser le contenu du dossier tel quel. Aucune étape de build. `pdf.js` est
chargé depuis un CDN dans `index.html`.
