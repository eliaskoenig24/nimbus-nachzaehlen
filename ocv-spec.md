# OCV v0.1 – Spezifikation der verifizierten Stimme

Stand: 17.11.2026 · Entwurf

## 1. Garantien
OCV garantiert:
1. **Einmaligkeit:** pro Person (erkannt an Name und Geburtsdatum aus dem Chip) und Frage höchstens
   eine gezählte Stimme; pro Dokument ohnehin.
2. **Echtheit:** jede verifizierte Stimme geht auf ein staatlich signiertes Chip-Dokument zurück.
3. **Anonymität:** niemand (auch nicht der Betreiber) kann eine Stimme einer Person zuordnen.
4. **Unverknüpfbarkeit:** Stimmen derselben Person zu verschiedenen Fragen sind nicht verbindbar.
5. **Nachzählbarkeit:** jeder kann alle verifizierten Stimmen prüfen und das Ergebnis nachrechnen.

OCV garantiert NICHT: dass die Person am Handy der Inhaber ist (geprüft wird es per Gesichtsabgleich
auf dem Handy, aber nur so zuverlässig, wie dieser Täuschungen erkennt); dass Doppelstaatler nur eine
Stimme haben; dass Personen mit unterschiedlichen Namen in verschiedenen Dokumenten als eine Person
erkannt werden; dass zwei Menschen mit gleichem Namen und Geburtsdatum beide teilnehmen können (der
zweite wird abgelehnt); dass der Server Name und Geburtsdatum nicht speichert (er sieht sie kurz;
das ist eine Zusage, keine technische Garantie); dass ein Staat keine falschen Dokumente ausstellt; Schutz vor Druck;
Repräsentativität. Diese Grenzen werden öffentlich genannt.

## 2. Begriffe
| Begriff | Bedeutung |
| --- | --- |
| Dokument | Reisepass/Ausweis mit NFC-Chip, vom Staat signiert |
| Dokument-Nachweis | ZK-Nachweis vom Handy: „echtes Dokument, Staatsangehörigkeit X“ |
| Registrierungs-ID | für dasselbe Dokument + Domain + Scope immer gleich (ZKPassport: `uniqueIdentifier`) |
| Abstimmungs-Identität | Semaphore-Identität, geheimer Schlüssel nur auf dem Gerät |
| Commitment | öffentlicher Fingerabdruck der Abstimmungs-Identität |
| Landesgruppe | Semaphore-Gruppe je Staatsangehörigkeit (oder Sammelgruppe) |
| Stimmkennung | Semaphore-Nullifier mit Scope = Fragen-ID |
| Prüfprotokoll | öffentliche, append-only Liste aller verifizierten Stimmen |

## 3. Einmalige Verifizierung
0. Verifizieren und Abstimmen auf dem Handy (E12; Lenkung, keine Sperre).
1. Webseite erzeugt über das ZKPassport-SDK eine Anfrage mit Scope `registrierung` und öffnet damit
   das offizielle ZKPassport-Fenster (`verify.zkpassport.id`, E12);
   angefordert werden: Staatsangehörigkeit, Mindestalter (16, offen), Vorname, Nachname,
   Geburtsdatum, Ablaufdatum. Nur gültige Dokumente werden angenommen.
2. Fenster → ZKPassport-App → Chip lesen → Gesichtsabgleich mit dem Chipfoto (streng, mit
   Lebenderkennung, nur auf dem Handy) → Nachweis lokal erzeugen.
3. Server prüft den Nachweis selbst und erhält Registrierungs-ID (pro Dokument) + Staatsangehörigkeit.
   Aus Name (MRZ-Form, auf 30 Zeichen gekürzt) und Geburtsdatum bildet er mit einem geheimen
   Schlüssel den **Personenschlüssel** (HMAC-SHA256) und verwirft Name und Geburtsdatum.
4. Browser erzeugt Semaphore-Identität und sendet nur das Commitment.
5. Registrierungs-ID und Personenschlüssel neu → Commitment in die Landesgruppe eintragen.
6. Registrierungs-ID bekannt → **Gerätewechsel** (nicht neues Konto):
   altes Commitment entfernen, neues eintragen. Das neue darf nur bei Fragen abstimmen,
   die **nach** dem Wechsel eröffnet wurden. Wechsel werden öffentlich gezählt.
   Höchstens ein Wechsel in 7 Tagen (E11); erneutes Verifizieren mit demselben Gerät ist frei.
7. Registrierungs-ID neu, Personenschlüssel bekannt (zweites Dokument derselben Person):
   - altes Dokument abgelaufen (ab Folgemonat) → neues Dokument übernimmt die Registrierung;
   - sonst → abgelehnt; Ablehnungen werden öffentlich gezählt.

Kleine Länder: Landesgruppen unter der Mindestgröße (Vorschlag 100) gehen in eine Sammelgruppe
„weitere Länder“; die Staatsangehörigkeit erscheint dann nicht im Stimmnachweis.

## 4. Stimmabgabe
1. Jede Frage hat eine ID und je Gruppe eine veröffentlichte, nur wachsende Liste zugelassener
   Mitglieder: alle Mitglieder bei Eröffnung, danach jede Person, die sich während der Laufzeit
   **zum ersten Mal** registriert (Späteinsteiger, E20). Zu jeder Listengröße gehört eine Wurzel.
   Ein Gerätewechsel fügt das neue Gerät nicht hinzu; nach einer Löschung rückt dieselbe Person bei
   den damals laufenden Fragen nicht nach.
2. Gerät erzeugt Semaphore-Nachweis: Gruppe = alle zugelassenen Mitglieder seiner Gruppe (neueste Wurzel),
   Scope = Fragen-ID, Nachricht = Antwort.
3. Server prüft Nachweis, Wurzel, Scope, Antwort (mit denselben Regeln wie das Auszählungsskript);
   schreibt Eintrag ins Prüfprotokoll; Quittung = Position + Prüfwert.
4. **Neu abstimmen:** gleiche Stimmkennung wird erneut protokolliert, gezählt wird nur die letzte.
5. Unverifizierte Stimmen: getrennt (zufällige Cookie-ID), nie im Prüfprotokoll, nur als eigene Zahl.
   (Im Prototyp nicht gebaut, E8.)

## 5. Prüfprotokoll und Auszählung
Eintrag: laufende Nr. (je Frage), Fragen-ID, Gruppen-ID, Wurzel, Stimmkennung, Antwort, Nachweis,
Hash des vorherigen Eintrags. Keine Uhrzeit, auch nicht gerundet (E8). Eine Hash-Kette je Frage;
erster Eintrag verweist auf `sha256("ocv-ledger-v1|genesis|<Fragen-ID>")`.
Scope einer Frage: `sha256("ocv-ledger-v1|scope|<Fragen-ID>")` als Zahl, modulo Feldgröße.

Regeln: nur anhängen; täglicher letzter Hash wird extern veröffentlicht; Stimmen gegen
nicht veröffentlichte Wurzeln sind ungültig; nach Fragenende Protokoll als Datei.

Auszählung (quelloffenes Skript): Hash-Kette prüfen → jeden Nachweis prüfen → je Stimmkennung
nur den letzten Eintrag → zählen gesamt und je Gruppe → Gruppen unter Mindestzahl nicht einzeln
ausweisen → mit veröffentlichtem Ergebnis vergleichen.

## 6. Datenmodell
| Tabelle | Felder | Öffentlich |
| --- | --- | --- |
| registrations | registration_id, commitment, group_id, rotated_at | nein (getrennt, verschlüsselt) |
| groups | group_id, members (commitments), root | ja |
| questions | question_id, text, options, opens_at, closes_at, eligible (je Gruppe: leaves, sizes, roots) | ja |
| ledger | siehe §5 | ja |
| unverified_votes | question_id, option, cookie_id, hour_bucket | nur als Summe |

Nie gespeichert: Name, Geburtsdatum, Dokumentnummer, Foto, IP zu Stimmen, genaue Zeiten, Geräte-IDs.

## 7. Sicherheitsanforderungen
| Nr. | Anforderung | Ab |
| --- | --- | --- |
| S1 | Doppelte Registrierungs-ID → nie zweites Konto | Prototyp |
| S2 | Inhaber kann fremde Registrierung seines Dokuments per Neu-Verifizierung übernehmen; Wechsel öffentlich gezählt | Prototyp |
| S3 | Stimmen nur gegen für die Frage veröffentlichte Wurzeln; jede Wurzel aus den ersten n zugelassenen Mitgliedern nachrechenbar; Gerätewechsel und Löschen+Neu-Registrieren bringen keinen zweiten Platz in einer laufenden Frage | Prototyp |
| S4 | Keine IPs/genauen Zeiten zu Stimmen in Logs | Prototyp |
| S5 | Auszählung + Server-Code quelloffen | Pilot |
| S6 | Auffälligkeiten je Land erkennen und markieren | Pilot |
| S7 | Active Authentication prüfen, wo möglich | Pilot |
| S8 | Optionaler lokaler Gesichtsabgleich mit Chipfoto | später |
| S9 | Externe Sicherheitsprüfung | Phase 2 |
| S10 | Challenge „Fälscht uns“ | Pilot |

Bekannte Grenze passbasierter Nachweise: Wer einen Pass einmal ausgelesen hat, kann ihn vor dem
Inhaber registrieren (→ S2).

## 8. Offene Entscheidungen
- Mindestalter 16 oder 18?
- Altersgruppen offenlegen (erst ab Pilot, grob)?
- Mindestgröße Landesgruppe (Vorschlag 100)?
- Wo wird der tägliche Hash veröffentlicht (Vorschlag: öffentliches Git-Repo)?
