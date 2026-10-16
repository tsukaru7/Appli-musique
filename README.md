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

## 2. Mode principal : « soirée »

```
   ┌──────────────────────────┐            ┌──────────────┐
   │  ORDINATEUR (hôte)       │  ◄──────►  │  Téléphone 1 │
   │  - connecté à Spotify    │            ├──────────────┤
   │  - joue les extraits     │  ◄──────►  │  Téléphone 2 │
   │  - affiche les scores    │            ├──────────────┤
   │  (idéalement + enceinte) │  ◄──────►  │  Téléphone 3 │
   └──────────────────────────┘            └──────────────┘
```

- L'**ordinateur** est l'hôte : il est connecté à Spotify, joue le son et affiche la partie
  (manche en cours, temps, scores).
- Chaque joueur rejoint la partie sur **son téléphone** via un code ou un QR code, dans le
  navigateur, sans rien installer et sans compte Spotify.
- Les joueurs tapent leur réponse avec une **autocomplétion** sur les titres de la playlist.
- Aucun titre n'est affiché pendant l'écoute → pas de triche possible.

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
- [ ] Connexion Spotify de l'hôte (OAuth PKCE)
- [ ] Choix d'une playlist : les siennes, ou un lien de playlist publique
- [ ] Lecteur intégré sur l'ordinateur, extraits de durée croissante
- [ ] Création d'une partie avec code + QR code
- [ ] Les joueurs rejoignent depuis leur téléphone avec un pseudo
- [ ] Réponse avec autocomplétion, bouton « passer »
- [ ] Calcul des points, révélation du morceau (titre, artiste, pochette) entre les manches
- [ ] Classement final
- [ ] Prototype de validation : précision du lecteur sur des extraits de 1 s

### Version 2 — Plus de façons de jouer
- [ ] Son joué sur un appareil Spotify Connect (enceinte, télé, console…) : plus besoin d'ordinateur
- [ ] Mode solo
- [ ] Options de partie : nombre de manches, paliers de durée, deviner le titre et/ou l'artiste

### Version 3 — Bonus
- [ ] Défi du jour (même morceau pour tout le monde)
- [ ] Historique des parties et statistiques par joueur
- [ ] Mode solo sur téléphone « à l'honnêteté » (le titre s'affiche dans la notification Spotify)

## 5. Choix techniques (proposition)

- **Application web** en TypeScript (React + Vite) : une page « hôte » pour l'ordinateur et une
  page « joueur » pour les téléphones.
- **Petit serveur Node.js avec WebSocket** (Socket.IO) pour synchroniser la partie en temps réel
  entre l'ordinateur et les téléphones.
- **Spotify** : Web API (playlists, recherche) + Web Playback SDK (lecture sur l'ordinateur).
- **Hébergement** : à choisir (ex. Render, Railway, Fly.io), avec une adresse HTTPS
  obligatoire pour la connexion Spotify.

## 6. Prérequis côté Spotify

1. Le créateur de l'app doit avoir un compte **Spotify Premium**.
2. Créer une app sur le [tableau de bord développeur Spotify](https://developer.spotify.com/dashboard)
   et récupérer son **Client ID**.
3. Déclarer l'adresse de retour (*Redirect URI*) de l'app.
4. Ajouter dans *User Management* l'e-mail Spotify de chaque personne qui sera hôte (5 max).
