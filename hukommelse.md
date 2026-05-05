# V2H Projekt — Hukommelse

Læs denne fil ved start af hver session. Hold den opdateret løbende.

---

## Hvad er projektet
Universitetsprojekt i Brugerdrevet Design. Fysisk miniatureprototype af V2H (Vehicle-to-Home).
- Legehus med LED strip (LED strip)
- Powerbank forklædt som elbil
- Browser/iPad interface der styrer hvornår huset trækker strøm fra bilen vs. nettet
- Rigtige elpriser fra Energinet API

---

## URL'er
- **App online (GitHub Pages):** https://lukasroland123.github.io/V2H-projekt/
- **ESP32 hardware API:** http://172.20.10.10 (kun tilgængelig på iPhone hotspot "Lukas - iPhone")

---

## Hardware
- **Mikrocontroller:** Adafruit QT Py ESP32-S3 (CircuitPython)
- **LED strip V2H strip:** board.A2, 30 pixels — grøn når V2H aktiv
- **LED strip legehus strip:** board.A3, 4 pixels — varm hvid lys
- **V2H relay:** board.A1
- **V2H toggle-knap:** board.SDA (fysisk ikke tilsluttet)
- **Barrel-stik detektion (bil-tilslutning):** board.A0 analog — A0 og GND fra barrel-jack — lav værdi = stik sat i
- **Stikontakt-knap:** board.RX — toggler legehus-lys uafhængigt

---

## Aftalte funktioner / designbeslutninger

### Swipe-knap låst til fysisk bil-tilslutning
Swipe-knappen i appen er **disabled (grå/locked)** indtil barrel-stikket (bilen) sættes i. Når trukket ud låses den igen automatisk.
- `car_connected` state i code.py styrer dette
- Detekteres via **analog A0** — når `barrel_pin.value < 5000` = stik sat i
- `locked` CSS-klasse på `.swipe-track` når ikke tilsluttet

### Batteri når minimumsgrænse → dialog
Når SOC når `min_soc` stopper V2H automatisk og viser dialog:
- **"Fortsæt til 0%"** → sætter min_soc til 0, kører videre til batteri er tomt
- **"Frakobl"** → frakobler og beholder grænsen
Ved 0%: frakobler automatisk, `car_connected = False`, swipe låses.

### Legehus lys
- El-bils knap (TX): tænder legehus + starter V2H + gult blink 1.8s
- Stikontakt-knap (RX): toggler legehus-lys uafhængigt af V2H

---

## Opstart
1. Tilslut QT Py til computer via USB
2. Kopier `til_esp32/code.py` til CIRCUITPY drevet
3. Åbn Mu editor → Serial
4. Tænd iPhone hotspot "Lukas - iPhone"
5. Ctrl+D i Serial — vent på "Server klar" + IP: 172.20.10.10
6. Åbn GitHub Pages linket i browser

---

## Teknisk stack
- **CircuitPython** på QT Py ESP32-S3
- **Vanilla HTML/CSS/JS** — ingen frameworks
- **GitHub Pages** til hosting
- **Energinet API:** `https://api.energidataservice.dk/dataset/Elspotprices`
