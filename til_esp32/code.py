import wifi
import socketpool
import ssl
import board
import neopixel
from digitalio import DigitalInOut, Direction, Pull
import time
import json
import os
import adafruit_requests

# WiFi
wifi.radio.connect("Lukas - iPhone", "lukasroland123")
print("IP:", wifi.radio.ipv4_address)

pool = socketpool.SocketPool(wifi.radio)
ssl_ctx = ssl.create_default_context()
requests = adafruit_requests.Session(pool, ssl_ctx)

server = pool.socket()
server.setsockopt(socketpool.SocketPool.SOL_SOCKET, socketpool.SocketPool.SO_REUSEADDR, 1)
server.bind(("0.0.0.0", 80))
server.listen(1)
server.setblocking(False)
print("Server klar")

# Hardware
pixels = neopixel.NeoPixel(board.A2, 30, brightness=0.2, auto_write=False, pixel_order=neopixel.GRB)
relay = DigitalInOut(board.A1)
relay.direction = Direction.OUTPUT
button = DigitalInOut(board.SDA)
button.direction = Direction.INPUT
button.pull = Pull.UP

bil_button = DigitalInOut(board.TX)
bil_button.direction = Direction.INPUT
bil_button.pull = Pull.UP

# Legehus hardware
legehus = neopixel.NeoPixel(board.A3, 4, brightness=0.3, auto_write=False, pixel_order=neopixel.GRB)

stikontakt_button = DigitalInOut(board.RX)
stikontakt_button.direction = Direction.INPUT
stikontakt_button.pull = Pull.UP

# State
v2h_active = False
last_button = True
battery_soc = 95.0
min_soc = 20.0
savings_kr = 0.0
savings_kwh = 0.0
auto_stop = False
price_ore = 100.0
last_price_fetch = -9999
last_tick = time.monotonic()

legehus_lights_on = False
car_connected = False
last_barrel_in = True
last_stikontakt = True
car_flash_until = 0        # tidspunkt hvor blink-animation slutter
FLASH_INTERVAL = 0.3       # sekunder pr. blink-fase

buf = bytearray(2048)


def fetch_price():
    global price_ore
    try:
        url = (
            "https://api.energidataservice.dk/dataset/Elspotprices"
            '?offset=0&limit=1&filter={"PriceArea":"DK2"}&sort=HourDK%20desc'
        )
        r = requests.get(url)
        data = r.json()
        r.close()
        spot = data["records"][0]["SpotPriceDKK"]
        price_ore = round(spot * 0.1, 1)  # DKK/MWh -> øre/kWh
        print("Pris hentet:", price_ore, "øre/kWh")
    except Exception as e:
        print("Pris fejl:", e)


def send_all(conn, data):
    pos = 0
    while pos < len(data):
        sent = conn.send(data[pos:pos+1024])
        if sent <= 0:
            break
        pos += sent

def send_response(conn, status, content_type, body):
    if isinstance(body, str):
        body = body.encode("utf-8")
    header = (
        "HTTP/1.1 " + status + "\r\n"
        "Content-Type: " + content_type + "\r\n"
        "Content-Length: " + str(len(body)) + "\r\n"
        "Access-Control-Allow-Origin: *\r\n"
        "Connection: close\r\n\r\n"
    )
    send_all(conn, header.encode("utf-8"))
    send_all(conn, body)


def serve_file(conn, path, content_type="text/html; charset=utf-8"):
    try:
        header = (
            "HTTP/1.1 200 OK\r\n"
            "Content-Type: " + content_type + "\r\n"
            "Connection: close\r\n\r\n"
        )
        send_all(conn, header.encode("utf-8"))
        with open(path, "rb") as f:
            while True:
                chunk = f.read(512)
                if not chunk:
                    break
                send_all(conn, chunk)
    except Exception as e:
        print("serve_file fejl:", e)
        send_response(conn, "404 Not Found", "text/plain", "Not found")


fetch_price()
last_price_fetch = time.monotonic()

while True:
    now = time.monotonic()
    dt = now - last_tick
    last_tick = now

    # Hent pris én gang i timen
    if now - last_price_fetch > 3600:
        fetch_price()
        last_price_fetch = now

    # Knap toggle (debounced)
    current_button = button.value
    if last_button and not current_button:
        time.sleep(0.05)
        if not button.value:
            v2h_active = not v2h_active
            if v2h_active:
                auto_stop = False
    last_button = current_button

    # El-bils knap — tænder legehus-lys og starter V2H
    current_bil = bil_button.value
    if last_barrel_in and not current_bil:
        time.sleep(0.05)
        if not bil_button.value:
            if not car_connected:
                legehus_lights_on = True
                car_connected = True
                v2h_active = True
                auto_stop = False
                car_flash_until = now + 1.8
            else:
                car_connected = False
                v2h_active = False
    last_barrel_in = current_bil

    # Stikontakt — toggle legehus-lys uafhængigt af V2H
    current_stikontakt = stikontakt_button.value
    if last_stikontakt and not current_stikontakt:
        time.sleep(0.05)
        if not stikontakt_button.value:
            legehus_lights_on = not legehus_lights_on
    last_stikontakt = current_stikontakt

    # Opdater state når V2H er aktiv
    if v2h_active:
        battery_soc = max(0.0, battery_soc - 0.1 * dt)   # ~12 min fra 95% til 20%
        kwh = (2000.0 / 3600.0 / 1000.0) * dt            # 2 kW simuleret forbrug
        savings_kwh += kwh
        savings_kr += (price_ore / 100.0) * kwh

        if battery_soc <= min_soc:
            v2h_active = False
            auto_stop = True

        if battery_soc <= 0.0:
            battery_soc = 0.0
            v2h_active = False
            car_connected = False
            auto_stop = False

    # Hardware
    if v2h_active:
        relay.value = True
        pixels.fill((0, 255, 0))
    else:
        relay.value = False
        pixels.fill((0, 0, 0))
    pixels.show()

    # Legehus lys
    if now < car_flash_until:
        phase = int((car_flash_until - now) / FLASH_INTERVAL) % 2
        legehus.fill((255, 200, 0) if phase == 0 else (0, 0, 0))
    elif legehus_lights_on:
        legehus.fill((255, 180, 80))
    else:
        legehus.fill((0, 0, 0))
    legehus.show()

    # Web server
    try:
        conn, addr = server.accept()
        size = conn.recv_into(buf)
        request = buf[:size].decode("utf-8", "ignore")

        path = "/"
        try:
            path = request.split(" ")[1]
        except Exception:
            pass

        if path == "/status":
            iphone_charges = savings_kwh / 0.012
            status = {
                "v2h_active": v2h_active,
                "battery_soc": round(battery_soc, 1),
                "min_soc": round(min_soc, 0),
                "price_ore": price_ore,
                "savings_kr": round(savings_kr, 2),
                "savings_iphone": round(iphone_charges, 1),
                "auto_stop": auto_stop,
                "legehus_lights": legehus_lights_on,
                "car_connected": car_connected,
            }
            send_response(conn, "200 OK", "application/json", json.dumps(status))

        elif path.startswith("/on"):
            v2h_active = True
            auto_stop = False
            send_response(conn, "200 OK", "application/json", '{"ok":true}')

        elif path.startswith("/off"):
            v2h_active = False
            send_response(conn, "200 OK", "application/json", '{"ok":true}')

        elif path.startswith("/set_min"):
            try:
                val = float(path.split("v=")[1].split("&")[0])
                min_soc = max(0.0, min(90.0, val))
            except Exception:
                pass
            send_response(conn, "200 OK", "application/json", '{"ok":true}')

        else:
            send_response(conn, "404 Not Found", "text/plain", "Not found")

        conn.close()
    except OSError:
        pass

    time.sleep(0.01)
