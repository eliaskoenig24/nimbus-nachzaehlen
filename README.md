# Nimbus nachzählen

[Nimbus](https://nimbus.vote) ist ein Prototyp einer neutralen Abstimmungsplattform: jeder
verifizierte Mensch eine anonyme Stimme pro Frage, jede Stimme öffentlich nachzählbar.

Dieses Repository enthält **nur, was man zum Nachzählen braucht**: das Auszählungsskript, die
Spezifikation (`ocv-spec.md`) und die täglich gesicherten Anker und Prüfprotokolle. Der übrige Code
der Plattform wird nach dem ersten Test veröffentlicht.

## Selbst nachzählen

Du brauchst [Node.js](https://nodejs.org) ab Version 24.

```bash
git clone <dieses Repository>
cd <Ordner>
npm install
node count.ts https://nimbus.vote/api/questions/<fragen-id>/ledger
```

Das Skript prüft die Frage, die Hash-Kette und **jeden einzelnen** anonymen Nachweis und zählt pro
Stimmkennung nur die letzte Stimme. Ergebnis `alles geprüft und in Ordnung` und Exit-Code 0 heißt:
Das Protokoll ist in sich stimmig und so gezählt, wie die Plattform es zeigen sollte.

### Gegen einen früheren Anker prüfen

```bash
node count.ts protokolle/<fragen-id>.json --anchor anker/<datum>.json
```

Ein Anker hält für jede Frage fest, wie viele Einträge es an diesem Tag gab und welcher Prüfwert
zuletzt stand. Fehlt später ein Eintrag oder wurde einer geändert, meldet das Skript einen Fehler.

## Täglicher Anker

Eine GitHub Action (`.github/workflows/anker.yml`) läuft jeden Tag:

1. lädt den aktuellen Anker von `https://nimbus.vote/api/anchor` nach `anker/<datum>.json`,
2. lädt jedes Prüfprotokoll nach `protokolle/<fragen-id>.json`,
3. zählt jedes Protokoll gegen den letzten früheren Anker nach,
4. speichert alles als Commit.

Schlägt Schritt 3 fehl, wird der Lauf rot. Die Commit-Geschichte ist der öffentliche Beleg.

## Grenzen (ehrlich)

- Der Betreiber von Nimbus ist auch Besitzer dieses Repositorys und könnte die Geschichte hier
  umschreiben (Force-Push). Schutz bietet, dass **andere** das Repository klonen oder forken: Ihre
  Kopien kann niemand nachträglich ändern. Wer mitprüfen will, forkt es und lässt die Action selbst
  laufen.
- Das Nachzählen zeigt, dass alle gezählten Stimmen von registrierten Mitgliedern stammen und keine
  doppelt zählt. Ob jedes Mitglied ein echter, einmaliger Mensch ist, beruht auf der Registrierung
  mit Ausweis-Chip; das kann dieses Repository nicht prüfen.
- Ergebnisse von Nimbus sind **nicht repräsentativ**.
