# Appli-musique

Un jeu de « blind test » façon **Songless / Heardle**, branché sur **Spotify** : on écoute un
extrait de plus en plus long d'un morceau et on doit trouver le titre le plus vite possible,
avec ses propres playlists ou des playlists publiques.

Projet **privé entre amis**, pas destiné à être publié.

---

## 1. Principe du jeu

1. Un joueur connecte son compte **Spotify Premium** et choisit une playlist.
2. L'application tire un morceau au hasard dans la playlist.
3. Elle joue un extrait très court (ex. 1 s). Les joueurs tentent de deviner le titre.
4. À chaque mauvaise réponse (ou « passer »), l'extrait s'allonge : 1 s → 2 s → 4 s → 7 s → 11 s → 16 s.
5. Moins on a eu besoin d'écouter, plus on marque de points.
6. On enchaîne les manches, puis on affiche le classement.

## 2. Deux modes de jeu (au choix de l'hôte)

### 📱 Mode Deezer : chacun sur son téléphone (par défaut)

- L'hôte se connecte à Spotify et choisit la playlist, depuis n'importe quel appareil.
- Le serveur retrouve les morceaux sur **Deezer** (grâce à leur code ISRC, sinon titre + artiste)
  et récupère leurs **extraits publics de 30 s** : aucun compte Deezer n'est nécessaire.
- Chaque joueur écoute l'extrait **sur son téléphone** et avance **à son rythme**, comme dans
  Songless : une erreur ou « passer » débloque l'extrait plus long. Le joueur qui trouve à 1 s
  gagne 600 pts, celui qui trouve à 4 s en gagne 400.
- La manche se termine quand tout le monde a trouvé ou abandonné. L'écran de l'hôte affiche qui
  en est où, puis joue l'extrait à la révélation.
- Limite : l'extrait Deezer n'est pas forcément le début du morceau.

### 🔊 Mode Spotify : soirée autour d'un ordinateur

```
   ┌──────────────────────────┐            ┌──────────────┐
   │  ORDINATEUR (hôte)       │  ◄──────►  │  Téléphone 1 │
   │  - connecté à Spotify    │            ├──────────────┤
   │  - joue les extraits     │  ◄──────►  │  Téléphone 2 │
   │  - affiche les scores    │            ├──────────────┤
   │  (idéalement + enceinte) │  ◄──────►  │  Téléphone 3 │
   └──────────────────────────┘            └──────────────┘
```

- L'**ordinateur** est l'hôte : il est connecté à Spotify (Premium), joue le son depuis le début
  du morceau et affiche la partie.
- Tout le monde entend le même extrait : il s'allonge quand tous ceux qui n'ont pas trouvé ont
  répondu ou passé (une réponse par extrait).

### 🎧 Solo sur cet écran

- Personne à connecter : on écoute et on répond directement sur l'ordinateur, comme sur Songless.
- Le son vient de Spotify par défaut (le vrai morceau, depuis le début). Deezer reste disponible
  en secours (extraits de 30 s, silence du début sauté automatiquement).
- À la fin : le score sur le total possible.

### 🎮 Packs thématiques

À la place d'une playlist, on peut cocher un ou plusieurs packs, et les mélanger :

| Pack | Contenu |
|---|---|
| Jeux vidéo | 104 jeux : Mario, Zelda, Final Fantasy, Minecraft, Undertale… |
| Animés | 104 génériques d'animés japonais : Naruto, One Piece, Demon Slayer… |
| Films | 115 films, internationaux et français : Star Wars, Amélie Poulain, La Boum… |
| Dessins animés | 104 génériques et chansons en français : Goldorak, Le Roi lion… |

- C'est un jeu à part du blind test musical : l'accueil propose les deux (« Devine l'œuvre » et
  « Devine le morceau »).
- Pendant la manche, le type d'œuvre est affiché (« C'est un Film »). À la révélation, l'affiche
  ou la jaquette de l'œuvre est cherchée sur Wikipedia (pochette Deezer à défaut).
- On devine **l'œuvre** (le jeu, l'animé, le film…), pas le titre du morceau. Les autres noms
  courants sont acceptés (« Back to the Future » pour « Retour vers le futur »).
- Pas besoin de Spotify : les extraits viennent de Deezer (si le morceau officiel n'y est pas, une
  version reconnaissable est cherchée). Ça marche dans les trois façons de jouer.
- Les listes sont dans `src/shared/packs/` : une ligne par morceau, faciles à corriger ou compléter.

Dans les modes à plusieurs, les joueurs rejoignent la partie via un code ou un QR code, dans le
navigateur, sans rien installer et sans compte. Ils répondent avec une **autocomplétion** sur
les titres de la playlist.

## 3. Contraintes imposées par Spotify (à garder en tête)

| Contrainte | Conséquence pour nous |
|---|---|
| Le lecteur Spotify pour site web (*Web Playback SDK*) ne fonctionne **que sur navigateur d'ordinateur** et demande **Premium** | Le son est joué par l'ordinateur hôte, connecté à un compte Premium |
| App en **mode développement** : 5 comptes Spotify autorisés au maximum, à ajouter à la main dans le tableau de bord développeur | Seuls ces comptes peuvent être « hôte ». Les joueurs sur téléphone n'ont pas besoin de compte Spotify |
| Le mode étendu (utilisateurs illimités) est réservé aux entreprises avec 250 000 utilisateurs/mois, et les jeux/quiz sont interdits par la politique développeur | L'app reste privée ; si Spotify la désactive, le jeu ne marche plus |
| Les playlists éditoriales de Spotify (Top 50, Today's Top Hits…) ne sont plus accessibles aux nouvelles apps | On joue avec ses propres playlists ou des playlists publiques créées par des utilisateurs |
| Lancer/couper la lecture prend ~0,1 à 0,3 s | Extraits de 1 s minimum (pas de 0,1 s comme Songless) — à valider sur prototype |
| Les morceaux joués apparaissent dans l'historique Spotify de l'hôte | Accepté |

## 4. Feuille de route

### Version 1 — Mode soirée
- [x] Connexion Spotify de l'hôte (OAuth PKCE)
- [x] Choix d'une playlist : les siennes, ou un lien de playlist publique
- [x] Lecteur intégré sur l'ordinateur, extraits de durée croissante
- [x] Création d'une partie avec code + QR code
- [x] Les joueurs rejoignent depuis leur téléphone avec un pseudo
- [x] Réponse avec autocomplétion, bouton « passer »
- [x] Calcul des points, révélation du morceau (titre, artiste, pochette) entre les manches
- [x] Classement final
- [ ] Prototype de validation : précision du lecteur sur des extraits de 1 s

### Version 2 — Plus de façons de jouer
- [x] Mode Deezer : chacun écoute sur son téléphone, à son rythme
- [ ] Son joué sur un appareil Spotify Connect (enceinte, télé, console…) : plus besoin d'ordinateur
- [ ] Mode solo
- [ ] Options de partie : nombre de manches, paliers de durée, deviner le titre et/ou l'artiste

### Version 3 — Thèmes
- [x] Packs jeux vidéo, animés, films et dessins animés, mélangeables

### Version 4 — Bonus
- [ ] Défi du jour (même morceau pour tout le monde)
- [ ] Historique des parties et statistiques par joueur

## 5. Lancer le jeu sur son ordinateur

Prérequis : [Node.js](https://nodejs.org) 20 ou plus récent.

```bash
npm install     # une seule fois
npm run dev     # démarre le jeu
```

1. Sur l'ordinateur, ouvre **http://127.0.0.1:5173** (pas « localhost », Spotify le refuse) et
   connecte-toi avec Spotify.
2. Choisis une playlist : l'écran affiche un **code** et un **QR code**.
3. Les joueurs scannent le QR code avec leur téléphone. Ils doivent être sur le **même Wi-Fi**
   que l'ordinateur. Sous Windows, accepte la demande du pare-feu au premier lancement, sinon
   les téléphones ne pourront pas se connecter.
4. Lance la partie : l'ordinateur joue les extraits, les téléphones répondent.

Autres commandes : `npm test` (tests de la logique du jeu), `npm run build` puis `npm start`
(version de production, servie sur le port 3001).

### Mettre le jeu en ligne (sans rien installer)

Le jeu peut tourner sur [Render](https://render.com) (offre gratuite) : on obtient une adresse
du type `https://appli-musique.onrender.com` à ouvrir depuis n'importe quel ordinateur.

1. Créer un compte Render en se connectant avec GitHub.
2. **New → Blueprint**, choisir le dépôt `Appli-musique` (et la branche voulue) : Render lit
   `render.yaml` et déploie tout seul.
3. Dans le tableau de bord Spotify, ajouter la *Redirect URI*
   `https://<adresse-render>/callback`.

4. Dans Render, onglet **Environment**, ajouter la variable `HOST_PASSWORD` avec le mot de passe
   de son choix : il sera demandé pour créer une partie. Les joueurs, eux, n'ont besoin que du
   code de la partie (les essais de codes au hasard sont limités).

Sur l'offre gratuite, le serveur s'endort après 15 minutes sans visite : la première ouverture
prend environ une minute.

### Organisation du code

| Dossier | Contenu |
|---|---|
| `src/shared/` | Types échangés entre serveur et pages, vérification des réponses |
| `src/server/` | Serveur de jeu temps réel (parties, manches, paliers, points) et extraits Deezer |
| `src/client/host/` | Page hôte (ordinateur) : connexion Spotify, choix de playlist, lecteur, scores |
| `src/client/player/` | Page joueur (téléphone) : rejoindre, répondre, scores |
| `src/client/spotify/` | Connexion, appels à l'API et lecteur d'extraits Spotify |

## 6. Choix techniques (proposition)

- **Application web** en TypeScript (React + Vite) : une page « hôte » pour l'ordinateur et une
  page « joueur » pour les téléphones.
- **Petit serveur Node.js avec WebSocket** (Socket.IO) pour synchroniser la partie en temps réel
  entre l'ordinateur et les téléphones.
- **Spotify** : Web API (playlists, recherche) + Web Playback SDK (lecture sur l'ordinateur).
- **Hébergement** : à choisir (ex. Render, Railway, Fly.io), avec une adresse HTTPS
  obligatoire pour la connexion Spotify.

## 7. Prérequis côté Spotify

1. Le créateur de l'app doit avoir un compte **Spotify Premium**.
2. Créer une app sur le [tableau de bord développeur Spotify](https://developer.spotify.com/dashboard)
   et récupérer son **Client ID**.
3. Déclarer l'adresse de retour (*Redirect URI*) de l'app.
4. Ajouter dans *User Management* l'e-mail Spotify de chaque personne qui sera hôte (5 max).
