# Rapports de mission

Outil web autonome pour générer rapidement les rapports de fin de mission (transferts aéroport), à partir du planning du jour.

🔗 **Lien direct** : https://damienphan.github.io/rapport/

## Fonctionnement

1. **Choisir le porteur** — sélectionne ton nom dans la liste (ou "Autre..." pour en saisir un).
2. **Coller le planning** — copie le texte du planning PDF du jour et colle-le dans la zone de texte.
3. **Extraire** — un clic repère tous les blocs où le nom du porteur apparaît et préremplit automatiquement :
   - Booking #, date, vol, terminal, type de service (DEP/ARR)
   - Client, greeteur, nombre de passagers
   - Lieu de dépose (Tapis bagage / Dépose minute / Parking pro / Check-in + numéro de vol pour les départs)
4. **Compléter** — ajuste les champs restants (bagages, détaxe, lieu de rencontre, problème, porteurs, satisfaction). Le total de bagages se calcule automatiquement.
5. **Générer le rapport** — copie le texte formaté dans le presse-papier, prêt à coller dans le message à envoyer.

Chaque clic sur "Extraire" remplace la liste par les missions du porteur sélectionné (utile pour changer de porteur).

Un bouton **"+ Ajouter une mission manuelle"** permet d'ajouter une mission absente du planning, avec une fiche vierge.

## Particularités

- Les valeurs par défaut (porteurs, satisfaction, détaxe, lieux...) sont mémorisées d'une mission à l'autre pendant la session, pour limiter les ressaisies.
- Les champs "Lieu de rencontre" et "Lieu de dépose" ont une option "Autre..." avec saisie libre pour les cas non standards.
- La date est préremplie avec la date du jour si elle n'est pas trouvée dans le planning.

## Technique

Fichier `index.html` unique, sans dépendance externe ni serveur — HTML/CSS/JS vanille. Fonctionne hors-ligne une fois ouvert dans un vrai navigateur (Safari/Chrome). 

⚠️ L'aperçu "Quick Look" des fichiers (Files iOS) désactive JavaScript : utiliser le lien GitHub Pages ou ouvrir le fichier dans un navigateur complet.

## Mettre à jour

1. Ouvrir `index.html` dans ce repo.
2. Crayon (éditer) → coller le nouveau contenu → "Commit changes".
3. Le site se met à jour automatiquement en quelques secondes via GitHub Pages.

## Limites connues

- L'extraction est basée sur des motifs de texte (regex) et dépend de la mise en forme du PDF exporté ; certains champs (vol, terminal, client) peuvent nécessiter une correction manuelle en cas d'OCR imprécis ou de blocs fusionnés dans le planning.
- Aucune donnée n'est sauvegardée entre deux ouvertures de la page (pas de stockage persistant).
