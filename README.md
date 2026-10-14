# Coche ✓

Une petite to-do list pour Windows, sobre et motivante.
Elle se lance avec le PC, reste discrète dans la barre des tâches, et t'envoie quelques coups de pouce au hasard dans la journée.

Pas de compte, pas de cloud : tes listes restent sur ton PC.

## Installer Coche

1. Va dans l'onglet **Releases** du dépôt et télécharge **Coche_…_x64-setup.exe**.
2. Double-clique dessus. Pas besoin d'être administrateur.
3. Si Windows affiche « Windows a protégé votre ordinateur », clique sur **Informations complémentaires** puis **Exécuter quand même**. (Ce message apparaît pour toutes les applis qui ne sont pas signées avec un certificat payant.)
4. À la fin, laisse cochées **Créer un raccourci sur le bureau** et **Lancer Coche**.

C'est tout : Coche s'ouvre, et se relancera tout seul à chaque démarrage du PC (désactivable dans les réglages).

### Mises à jour

Coche vérifie tout seul s'il existe une nouvelle version, au démarrage puis toutes les 6 heures. Quand c'est le cas, un bandeau **Mettre à jour** apparaît en haut de la fenêtre : un clic, et Coche se met à jour puis se relance, sans perdre vos tâches.

### Désinstaller

Le plus simple : **Réglages de Coche → Désinstaller Coche**, ou **menu Démarrer → Désinstaller Coche**.

Passer par Paramètres Windows → Applications fonctionne aussi, sauf si le « contrôle intelligent des applications » de Windows 11 est activé : il bloque le désinstalleur parce que Coche n'est pas signé numériquement (message « Error launching installer »). Dans ce cas, utilise l'un des deux chemins ci-dessus.

Vos tâches restent sur le PC après la désinstallation, sauf si tu coches la case pour les supprimer.

## Ce que fait Coche

- **Plusieurs listes** (Perso, Maison, Boulot…)
- **Ajout ultra rapide** : `Ctrl + Alt + H` depuis n'importe où, ou commence simplement à taper dans la fenêtre
- **Tâche du jour** : clique sur l'étoile pour mettre une tâche en avant
- **Coups de pouce aléatoires** : 0 à 8 notifications par jour, dans la plage horaire de ton choix, jamais quand la fenêtre est déjà ouverte
- **Zéro culpabilité** : pas de retard, pas de rouge. On ne compte que ce qui est fait (aujourd'hui et cette semaine)
- **Un panda roux** sur sa branche de bambou : il saute quand tu coches, lève les bras quand une liste est finie, fait la sieste quand il n'y a rien à faire. Chaque tâche faite aujourd'hui fait pousser une feuille sur sa branche
- Chaque matin, les tâches terminées la veille disparaissent : la liste repart propre
- Mode clair et sombre automatiques

## Raccourcis

| Action | Comment |
| --- | --- |
| Ajouter une tâche depuis n'importe où | `Ctrl + Alt + H` |
| Modifier une tâche | Double-clic sur son texte |
| Renommer une liste | Double-clic sur la liste |
| Supprimer une liste | Clic droit sur la liste |
| Fermer les réglages | `Échap` |

Fermer la fenêtre ne quitte pas Coche : il se range à côté de l'horloge. Pour quitter, passe par les réglages ou le clic droit sur l'icône.

## Personnaliser les messages

Les messages des notifications sont dans un fichier texte que tu peux modifier : **Réglages → Modifier les messages**.
Variables disponibles : `{tache}` (une tâche tirée au sort), `{restant}` (nombre de tâches à faire), `{fait}` (nombre faites aujourd'hui).

Les données sont dans `%APPDATA%\fr.pandaroux.coche\` (`data.json` et `messages.json`).

## Pour les développeurs

Il faut, une seule fois :

1. **Node.js** (version LTS) : https://nodejs.org
2. **Rust** : https://rustup.rs
3. **Microsoft C++ Build Tools** avec l'option « Développement Desktop en C++ » : https://visualstudio.microsoft.com/fr/visual-cpp-build-tools/

Ensuite, dans le dossier du projet :

```bash
npm install        # installe l'outil Tauri
npm run dev        # lance Coche en mode développement
npm run build      # crée l'installateur dans src-tauri/target/release/bundle/nsis/
```

Les icônes sont générées depuis `app-icon.svg` avec `npm run icons`.

Astuce : on peut aussi ouvrir `src/index.html` directement dans un navigateur pour travailler sur le design (les données vont alors dans le navigateur).

### Publier une nouvelle version

Pas besoin de compiler soi-même : GitHub le fait, et signe la mise à jour pour que les Coche déjà installés la reçoivent.

Une seule fois : ajoute la clé secrète de signature (créée avec `npx tauri signer generate`) dans **Settings → Secrets and variables → Actions**, sous le nom `TAURI_SIGNING_PRIVATE_KEY`. La clé publique correspondante est déjà dans `src-tauri/tauri.conf.json`. Si tu forkes le projet, génère ta propre paire de clés et remplace la clé publique et l'adresse du dépôt dans ce fichier.

Ensuite, à chaque version : change le numéro dans `src-tauri/tauri.conf.json`, puis :

```bash
git tag v0.1.0
git push origin v0.1.0
```

Quelques minutes plus tard, l'installateur apparaît dans **Releases**.

## Organisation du code

```
src/                  l'interface (HTML, CSS, JavaScript, sans framework)
  index.html
  style.css
  app.js              listes, animations, sons, réglages
src-tauri/            la partie Windows (Rust)
  src/main.rs         sauvegarde, icône, démarrage auto, raccourci, notifications aléatoires
  tauri.conf.json     configuration de l'appli et de l'installateur
.github/workflows/    création automatique de l'installateur
```

## Licence

MIT. Fais-en ce que tu veux, et si ça t'aide à avancer, tant mieux 🙂

La police [Bricolage Grotesque](https://github.com/ateliertriay/bricolage) est distribuée sous licence SIL Open Font License.
