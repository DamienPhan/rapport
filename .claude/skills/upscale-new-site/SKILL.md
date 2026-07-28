---
name: upscale-new-site
description: Adapt this mission-report app to a new airport/site or agency that uses the same PDF table format. Use when asked to add support for a new site, branch a new airport, or duplicate the config for a different handling agency.
---

# Upscaling vers un autre site (multi-aéroport / multi-agence)

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
   `parser-text.js` — voir la dette technique documentée dans le `CLAUDE.md`
   à la racine du dépôt (§7).
5. `npm test` avec une fixture du nouveau site.

**Ce qui rend cela possible** : `src/core/parser-pdf.js` ne contient AUCUNE
valeur propre à un site (vérifié à l'audit v2 : 0 littéral NCE/ACA/Well'Com).
Tout passe par le paramètre `cfg`.

**Passage natif (futur)** : `src/core/` et `src/store/` étant purs (aucun
DOM), une app Capacitor ou React Native réutilise ces modules tels quels et
ne réécrit que `src/ui/app.js`. C'est la raison d'être de la frontière
core/ui documentée dans le `CLAUDE.md` racine (§2).
