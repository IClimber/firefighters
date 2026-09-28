# Firefighters — браузерна P2P мультиплеєрна гра

## Спілкування
- Відповідай українською, коротко і по суті, без зайвих вступів.
- Відповідай строго на поставлене питання, не пропонуй альтернативних рішень, про які не просили.
- Стиль точний і технічно вимогливий.

## Суть гри
Вид згори. Зліва направо: річка (1/6 ширини, анімація течії зверху вниз), обочина (1/6), дорога (1/3, пунктирна розмітка по центру), посадка (1/3), що горить.
Гравці-пожежники бігають від річки до посадки з відрами: біля річки відро наповнюється автоматично, пробіл (або кнопка «Вилити» на телефоні) гасить палаючу ділянку, на якій стоїть гравець.

- Посадка — сітка 5 × 10 ділянок. Стани: `g` ціла (зелена), `f` горить (анімація вогню), `x` погашена (сіра), `b` згоріла (чорна). Сіра й чорна повторно не загоряються.
- Палаюча ділянка вигорає сама через `BURN_TIME`; вогонь поширюється на 8 сусідів з імовірністю `SPREAD_RATE`/сек.
- 1 відро = 1 ділянка.
- Кінець: немає палаючих і є зелені — перемога; зелених не лишилось — поразка. «Нова гра» доступна всім.
- Дорога: правосторонній рух (ліва смуга вниз, права вгору), смуга 1/6, машина 1/12 ширини, однакова швидкість, 3 типи (седан, позашляховик, вантажівка), рандомні кольори. Зіткнення: гравець блимає і не рухається 3 с, повне відро стає порожнім, потім 0,8 с імунітету.
- Гравець — піксельний спрайт пожежника вид збоку (намальований у коді), колір каски рандомний, відро видно порожнім/повним.
- Мобільне керування: при `matchMedia('(pointer: coarse)')` — хрестовина на 8 напрямків (одна сенсорна зона) зліва внизу і кнопка «Вилити» справа, Pointer Events з мультитачем.

## Архітектура
- Клієнт — `index.html` (HTML + CSS + JS-модуль гри) і `net.js` (мережевий шар, `import { createNet } from './net.js'`), без збірки і без зовнішніх JS-залежностей. Хоститься на GitHub Pages.
- `net.js` не знає про гру і призначений для кількох ігор: з'єднання, ретрансляція, вибір хоста, спільний годинник, живість, `bye`, статистика з'єднань, двійковий формат. Гра описує свої повідомлення схемами (`messages`) і отримує колбеки (`onMessage`, `onPeerOpen`, `onPeerGone`, `onWelcome`, `onVisibility`, `onWarn`, `onChange`); API і типи полів описані на початку файлу. Усе нижче про з'єднання, хоста, штампи, ретрансляцію й годинник реалізовано в `net.js`.
- Сервер сигналізації — `server/signal.mjs` (Node, пакет `ws`), служба `ff-signal` на VPS за nginx: `wss://144-172-110-72.sslip.io/ws`. Він лише знайомить гравців кімнати і пересилає опис WebRTC-з'єднань; сама гра йде напряму між браузерами (P2P, `RTCPeerConnection` + два DataChannel). Раніше пошук ішов через Trystero/публічні Nostr-релеї — це займало секунди і губило анонси, тому замінено. Готові бібліотеки (p2play-js, PlayPeerJS, NetplayJS, Trystero з ws-relay, Playroom) переглянуто 28.09.2026: жодна не має неповного mesh, заморожування, пріоритету «в кого є гра» і спільного годинника; з p2play-js взято ненадійний канал для руху і пропуск при переповненні.
- Двійковий формат скрізь (і з сервером, і між гравцями): перший байт — тип, далі поля за схемою (`u8`…`f64`, `bool`, `str` UTF-8 з varint-довжиною, `bytes`, масиви, об'єкти). Декодування суворе: зайві/відсутні байти, NaN/Infinity, bool не 0/1, битий UTF-8 — повідомлення відкидається.
- Канали на пару: `r` (id 0, надійний упорядкований) і `u` (id 1, `ordered:false, maxRetransmits:0`), обидва `negotiated`. Повідомлення з `unreliable` (у грі — `pos`) ідуть через `u` з номером (`u32` після байта типу), застарілі за номером відкидаються; якщо в каналі > 64 КБ ненадісланого — не надсилаються. Адресні (`send` з `to`) завжди йдуть через `r`.
- Версія: `hello.v` — хеш схем усіх повідомлень (+ `WIRE`, + `opts.version`). Від гравця з іншою версією (стара сторінка в кеші) ігрові повідомлення не приймаються, він не рахується і не стає хостом; обидва бачать попередження. Версію протоколу з сервером (`PROTOCOL` = 2) перевіряє сервер: інша або текстовий кадр — закриття 4005, клієнт не перепідключається і просить перезавантажити сторінку.
- Кімната — хеш URL (`#roomId`); якщо його нема, генерується. Вхід у гру — просто за посиланням. На сервері кімнати розділені за грою (`game` у `join`, для цієї гри — `firefighters`).
- Топологія mesh, але стан вогню авторитетний. Хост обирається так: спершу ті, в кого вже є гра (`hello.g`), далі менший штамп `t`, при рівності — менший id. Не беруть участі (поки є інші кандидати) ті, хто відійшов (вкладка прихована, `hello.a`) або мовчить довше `LIVE_MS` (3 с).
- Штамп `myStamp` — місце в черзі: спершу `Date.now()` при вході, далі тільки зростає (`restamp` = max відомих + 1) — після приєднання до чужої гри, повернення вкладки з фону і після заморожування сторінки (пауза таймерів > `RESUME_GAP_MS`). Тому зсув годинника новачка і «розморожений» старий хост не перехоплюють роль.
- Хост симулює вогонь за реальним часом (тіки по 0,25 с, догін не більше `MAX_CATCHUP`) і розсилає стан; при переході в фон одразу шле свіжий `world` (`onVisibility` викликається до `hello` з `a`), роль переходить наступному. `checkResume` (виявлення заморожування) викликається перед кожним надсиланням і вибором хоста, тож «розморожений» хост спершу стає в кінець черги.
- Вхід: одразу `WebSocket` до сервера, `join` → `welcome` зі списком присутніх. Кімната порожня — гра стартує одразу (`startSolo` → `newRound`). Хтось є — чекаємо стан від хоста до `JOIN_WAIT_MS` (8 с, кнопка «Почати без них»), потім граємо самі (коли з'єднання встановиться, ігри зіллються: хост — менший штамп). Сервер не відповів за `GRACE_MS` (3 с) — граємо самі, HUD попереджає.
- З'єднання: `selfId` — 20 випадкових символів на кожне завантаження сторінки. Offer завжди робить менший id (зустрічних offer-ів немає): новий у кімнаті (`welcome`/`joined`) — `connectTo`. Сигнали несуть `n` (id спроби), застарілі ігноруються; ICE-кандидати шлються лише після offer/answer, вхідні до `setRemoteDescription` буферизуються. Не відкрилося за `CONNECT_TIMEOUT_MS` (12 с), `failed`, `disconnected` довше `DISCONNECT_GRACE_MS` (5 с) чи закрився канал — `dropLink`, і якщо гравець ще в кімнаті, через `RETRY_MS` (2 с) менший id пробує знову, а більший шле йому `ask`. `left` від сервера закриває лише ще не відкрите з'єднання (відкрите P2P знає краще — сокет до сервера міг просто перепідключатися).
- Зв'язок із сервером: при обриві — перепідключення з тим самим `selfId` (backoff 0,5 → 15 с; одразу — при поверненні вкладки, `online`, розморожуванні). Повторний `welcome`: до гравців без відкритого з'єднання — `connectTo` або `ask`. P2P при цьому не рветься.
- Позиції гравців: кожен сам розсилає свою ~20 Гц (лише при зміні, інакше раз на секунду), у інших — згладжування. Гравця, від якого немає повідомлень `LIVE_MS`, не малюють і не рахують; хто відійшов — напівпрозорий. Дані гравців гри (`players`) окремо від мережевих (`peers` у `net.js`); `onPeerGone` їх видаляє.
- Вихід: на `pagehide` — `bye` через DataChannel і закриття WebSocket (сервер одразу шле `left`); WebRTC закриває сам браузер. Отримувачі `bye` одразу видаляють гравця, закривають з'єднання з ним і ігнорують його подальші повідомлення. `pageshow` з bfcache (у `net.js`) і `hashchange` (у грі) — перезавантаження.
- Неповний mesh: кожен у `hello.n` повідомляє прямих сусідів. Отримане напряму від X з `broadcast` (`hello`, `bye`, `clock`, у грі — `pos`, `world`) пересилається через `fwd` (байти як є) сусідам без прямого зв'язку з X; пересилає лише спільний сусід із найменшим id. Новому сусідові ретранслятор одразу шле останні `hello` недосяжних для нього гравців. Адресні повідомлення (`douse`/`restart` до хоста) без прямого з'єднання йдуть через спільного сусіда (один стрибок).
- Машини не передаються мережею: розклад детермінований від хешу roomId і спільного часу `net.sharedNow() = Date.now() + clockOffset`. Хост раз на секунду (і новому сусідові) шле `clock` зі своїм `sharedNow()`, решта приймає його лише від хоста й оцінює зсув як максимум `ht - Date.now()`; новий хост зберігає свій зсув, тому при зміні хоста машини не стрибають.
- ICE: STUN Google і Cloudflare + TURN, облікові дані якого (24 год, унікальне ім'я) сервер сигналізації дає прямо у `welcome`. Кожне з'єднання одразу з TURN (≈2 алокації на пару гравців; пулу offer-ів, як у Trystero, немає).
- HUD «Зв'язок:» — для кожного гравця (кружок кольору каски) тип з'єднання і пінг з `getStats()` обраної ICE-пари раз на 2 с: `LAN` (host–host), `P2P` (через NAT), `TURN`/`TURN/TLS` (relay), без прямого з'єднання — «через гравця».
- Усі вхідні повідомлення перевіряються (типи — схемою при декодуванні, межі й довжина сітки — у грі); хост приймає `douse`, лише якщо за останньою `pos` гравець має повне відро і стоїть на цій ділянці або сусідній. Від навмисного обману хостом у P2P захисту немає.
- `requestAnimationFrame` викликається на початку кадру; `rr` малює через `arcTo` (без `ctx.roundRect`).
- Зіткнення з машиною кожен гравець визначає локально для себе, прапорець оглушення йде в `pos`.

### Сервер сигналізації (`server/signal.mjs`)
- Двійковий протокол (опис на початку файлу). Клієнт → сервер: `1 join [версія u8][гра][кімната][id]`, `2 signal [кому][дані]`. Сервер → клієнт: `1 welcome [[id]][[[url] username credential]]`, `2 joined [id]`, `3 left [id]`, `4 signal [від кого][дані]`, `5 full`. Коди закриття: 4001 некоректний join, 4002 повна, 4003 замінено, 4005 інша версія / текстовий кадр, 4008 ліміт, 4029 забагато з IP.
- Дані сигналу сервер не розбирає. У `net.js` це `{n (id спроби), t (0 offer, 1 answer, 2 ICE-кандидат, 3 ask), s (sdp або candidate), mid, idx (-1 — немає), uf}`.
- Повторний `join` з тим самим id замінює старий сокет (перепідключення). Кімнати — `гра/кімната`; кімната видаляється, коли порожня; стану гри сервер не зберігає.
- Обмеження: кімната ≤ 16, ≤ 20 з'єднань з IP, 30 повідомлень/с (запас 300), `maxPayload` 16 КБ, ping кожні 15 с (не відповів — від'єднання), Origin лише з `FF_ORIGINS`. Логіка (`createSignalServer`) відокремлена від транспорту — тести запускають її з фейковими сокетами.
- Налаштування через змінні середовища: `FF_HOST`, `FF_PORT`, `FF_ORIGINS`, `FF_TURN_SECRET_FILE`, `FF_TURN_URLS`.

### Повідомлення (DataChannel, `net.send(kind, data, to?)`)
Службові (`net.js`):
- `hello` `{v u32 (версія), t f64 (штамп), a bool (away), g bool (є гра), n [str] (прямі сусіди)}` — при вході/виході сусідів, зміні стану (`net.announce()`) і раз на 5 с.
- `bye` `{}` — при закритті сторінки.
- `clock` `{ht f64}` — від хоста раз на секунду.
- `fwd` `{k u8 (тип), o str (автор), to str (адресат, '' — усім), d bytes (тіло як є)}` — ретрансляція.

Гри (`index.html`):
- `pos` (broadcast, unreliable) `{x u16, y u16, h u16 (hue), f i8 (face), b bool (full), m bool (moving), s bool (stunned)}` — 15 байт разом із типом і номером.
- `world` (broadcast) `{r f64 (round), g str (сітка), a [u16] (вік вогню, десяті секунди), p u8 (індекс у play|win|lose)}` — від хоста при змінах і раз на секунду.
- `douse` `{r f64, i u8}` — клієнт → хост; клієнт оптимістично гасить локально (`pending`), хост перевіряє і підтверджує.
- `restart` `{r f64}` — клієнт → хост.

### Світ
Координати світу 900 × 600, клітинка 60, масштабування під екран з letterbox. Основні константи на початку скрипта: `BURN_TIME`, `SPREAD_RATE`, `START_FIRES`, `SPEED`, `CAR_SPEED`, `CAR_SLOT`, `CAR_CHANCE`, `STUN_MS`, `MAX_CATCHUP`, `GRACE_MS`, `JOIN_WAIT_MS`. Мережеві — на початку `net.js`: `LIVE_MS`, `FORGET_MS`, `RESUME_GAP_MS`, `CONNECT_TIMEOUT_MS`, `DISCONNECT_GRACE_MS`, `RETRY_MS`, `BACKPRESSURE`, `PROTOCOL`, `WIRE`.

## Поточний стан
- Гра працює і опублікована на GitHub Pages; мобільне керування працює.
- TURN налаштований на VPS 144.172.110.72 (Ubuntu 24.04):
  - coturn: `/etc/turnserver.conf`, 3478 UDP/TCP, relay 49152–65535 UDP, `use-auth-secret`, `denied-peer-ip` для приватних мереж, `total-quota=2000`, `user-quota=100`, `max-bps=64000`, `bps-capacity=6250000`, `no-tcp-relay`.
  - TURN/TLS на 443: nginx `stream` (`/etc/nginx/stream.d/ff-turn.conf`, модуль `libnginx-mod-stream`) ділить 443 за ALPN: без ALPN або `stun.turn` → `127.0.0.1:4431` (nginx знімає TLS і шле TURN/TCP у coturn 3478), решта → HTTPS на `127.0.0.1:4430` з `proxy_protocol` (справжня IP через `real_ip_header proxy_protocol`).
  - Секрет: `/etc/ff-turn/secret` (root:www-data 640), його читають coturn (у конфігу) і PHP.
  - Ендпоінт: `https://144-172-110-72.sslip.io/turn.php` (`/var/www/ff-turn/turn.php`, nginx `/etc/nginx/sites-available/ff-turn`), `limit_req` 6/хв + burst 10 з IP. Облікові дані на 24 год з унікальним ім'ям `<expiry>:<random>` на кожен запит; URL `turn:144.172.110.72:3478?transport=udp` і `turns:144-172-110-72.sslip.io:443?transport=tcp`. CORS лише для `https://iclimber.github.io`. Сертифікат Let's Encrypt, автопродовження `certbot.timer` (nginx при продовженні перезавантажується, stream підхоплює новий сертифікат).
  - Нова гра `turn.php` не використовує (облікові дані TURN видає сервер сигналізації); ендпоінт лишився.
  - Сервер сигналізації: `/opt/ff-signal/signal.mjs` (копія `server/signal.mjs`), служба `/etc/systemd/system/ff-signal.service` (з `server/ff-signal.service`; `DynamicUser`, група `www-data` для читання секрету TURN, `NODE_PATH=/usr/share/nodejs`), Node 18 і `ws` з apt (`nodejs`, `node-ws`), слухає `127.0.0.1:8090`; nginx `location = /ws` у сайті `ff-turn` (`limit_req` 30/хв + burst 20). Оновлення коду сервера: `install -m 644 server/signal.mjs /opt/ff-signal/signal.mjs && systemctl restart ff-signal`.
- Автозапуск: `coturn`, `nginx`, `php8.3-fpm`, `certbot.timer`, `ff-signal` увімкнені в systemd; для coturn drop-in `/etc/systemd/system/coturn.service.d/override.conf` (`After=network-online.target`, `Restart=on-failure`), бо він прив'язаний до конкретної IP.
- `user-quota` рахується за частиною імені після `:`, тому `turn.php` робить її унікальною на кожен запит — квота діє на одне завантаження сторінки.
- Фаєрвол ufw: вхідні лише 22, 80, 443/tcp, 3478/udp, 49152–65535/udp (3478/tcp назовні закритий, nginx ходить у coturn локально). avahi вимкнено.
- Зміни 28.09.2026 застосовано скриптом `/root/ff-server-changes/apply.sh`; попередні конфіги — `/root/ff-backup-20260928/`.
- При зміні секрету треба оновити і `/etc/ff-turn/secret`, і `static-auth-secret` у `/etc/turnserver.conf`, потім `systemctl restart coturn`.

## Розгортання TURN на новому сервері
Відтворює поточний стан VPS один в один. Виконувати від root на чистій Ubuntu 24.04 із публічною IPv4 на інтерфейсі (якщо IP за NAT хмари — у `listening-ip`/`relay-ip` і в `proxy_pass` stream ставити приватну IP, а `external-ip=ПУБЛІЧНА/ПРИВАТНА`). Секрет у репозиторій не потрапляє — генерується на сервері.

```bash
IP=1.2.3.4                       # нова публічна IP
HOST=${IP//./-}.sslip.io         # sslip.io резолвить це ім'я в IP, потрібне для сертифіката

# 1. Пакети
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y coturn nginx libnginx-mod-stream php8.3-fpm certbot python3-certbot-nginx ufw

# 2. Секрет (його читають coturn і PHP)
install -d -m 750 -o root -g www-data /etc/ff-turn
openssl rand -hex 32 > /etc/ff-turn/secret
chown root:www-data /etc/ff-turn/secret && chmod 640 /etc/ff-turn/secret

# 3. coturn
cat > /etc/turnserver.conf <<'EOF'
listening-port=3478
listening-ip=__IP__
relay-ip=__IP__
external-ip=__IP__
min-port=49152
max-port=65535
realm=__HOST__
use-auth-secret
static-auth-secret=__SECRET__
fingerprint
stale-nonce=600
no-tls
no-dtls
no-cli
no-multicast-peers
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=100.64.0.0-100.127.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.0.0.0-192.0.0.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=198.18.0.0-198.19.255.255
denied-peer-ip=224.0.0.0-255.255.255.255
denied-peer-ip=::1
denied-peer-ip=fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff
denied-peer-ip=fe80::-febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff
syslog
simple-log
total-quota=2000
user-quota=100
max-bps=64000
bps-capacity=6250000
no-tcp-relay
EOF
sed -i "s/__IP__/$IP/g; s/__HOST__/$HOST/g; s/__SECRET__/$(cat /etc/ff-turn/secret)/" /etc/turnserver.conf
chown root:turnserver /etc/turnserver.conf && chmod 640 /etc/turnserver.conf
mkdir -p /etc/systemd/system/coturn.service.d
cat > /etc/systemd/system/coturn.service.d/override.conf <<'EOF'
[Unit]
Wants=network-online.target
After=network-online.target

[Service]
Restart=on-failure
RestartSec=5
EOF
systemctl daemon-reload && systemctl enable coturn && systemctl restart coturn

# 4. turn.php
install -d -m 755 /var/www/ff-turn
cat > /var/www/ff-turn/turn.php <<'EOF'
<?php
// Тимчасові облікові дані TURN за схемою TURN REST API (coturn use-auth-secret).
$allowed = ['https://iclimber.github.io'];
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($origin, $allowed, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
}
header('Content-Type: application/json');
header('Cache-Control: no-store');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

$secret = trim(@file_get_contents('/etc/ff-turn/secret'));
if ($secret === '') { http_response_code(500); echo '{"error":"no secret"}'; exit; }

$ttl = 24 * 3600;
// Окремий ідентифікатор на кожен запит: coturn рахує user-quota за частиною після ':'
$username = (time() + $ttl) . ':' . bin2hex(random_bytes(8));
$credential = base64_encode(hash_hmac('sha1', $username, $secret, true));
$ip = '__IP__';
$host = '__HOST__';   // для TLS ім'я має збігатися з сертифікатом

echo json_encode([
    'ttl' => $ttl,
    'iceServers' => [[
        // UDP і TLS на 443 (через nginx stream); звичайний TCP 3478 не віддаємо — менше алокацій
        'urls' => ["turn:$ip:3478?transport=udp", "turns:$host:443?transport=tcp"],
        'username' => $username,
        'credential' => $credential,
    ]],
]);
EOF
sed -i "s/__IP__/$IP/g; s/__HOST__/$HOST/g" /var/www/ff-turn/turn.php
systemctl enable --now php8.3-fpm

# 5. Сертифікат: тимчасовий сайт на 80, certbot у режимі --nginx
#    (так створюються options-ssl-nginx.conf, ssl-dhparams.pem і renewal з installer = nginx)
rm -f /etc/nginx/sites-enabled/default
cat > /etc/nginx/sites-available/ff-turn <<EOF
server { listen 80; listen [::]:80; server_name $HOST; root /var/www/ff-turn; location / { return 404; } }
EOF
ln -sf /etc/nginx/sites-available/ff-turn /etc/nginx/sites-enabled/ff-turn
nginx -t && systemctl reload nginx
certbot --nginx -d "$HOST" --agree-tos --register-unsafely-without-email --non-interactive

# 6. Остаточний сайт: HTTPS на 127.0.0.1:4430 за stream-проксі, ліміт запитів
cat > /etc/nginx/sites-available/ff-turn <<'EOF'
# Облікові дані TURN: не більше 6 запитів/хв з однієї IP (плюс запас 10)
limit_req_zone $binary_remote_addr zone=ffturn:1m rate=6r/m;

server {
    server_name __HOST__;
    root /var/www/ff-turn;

    location = /turn.php {
        limit_req zone=ffturn burst=10 nodelay;
        limit_req_status 429;
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/run/php/php8.3-fpm.sock;
    }
    location / { return 404; }

    # 443 приймає stream-проксі (/etc/nginx/stream.d/ff-turn.conf) і передає сюди з proxy_protocol
    listen 127.0.0.1:4430 ssl proxy_protocol;
    set_real_ip_from 127.0.0.1;
    real_ip_header proxy_protocol;
    ssl_certificate /etc/letsencrypt/live/__HOST__/fullchain.pem; # managed by Certbot
    ssl_certificate_key /etc/letsencrypt/live/__HOST__/privkey.pem; # managed by Certbot
    include /etc/letsencrypt/options-ssl-nginx.conf; # managed by Certbot
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem; # managed by Certbot
}
server {
    if ($host = __HOST__) {
        return 301 https://$host$request_uri;
    } # managed by Certbot

    listen 80;
    listen [::]:80;
    server_name __HOST__;
    return 404; # managed by Certbot
}
EOF

# 7. stream: 443 ділиться між HTTPS і TURN/TLS за ALPN
mkdir -p /etc/nginx/stream.d
cat > /etc/nginx/stream.d/ff-turn.conf <<'EOF'
# Порт 443 ділять HTTPS (turn.php) і TURN поверх TLS — для мереж, де відкритий лише 443/TCP.
# Розподіл за ALPN: браузери для HTTPS завжди надсилають ALPN (h2/http/1.1),
# а TURN-клієнти браузерів — ні (або "stun.turn", RFC 7443).
stream {
    map $ssl_preread_alpn_protocols $ff_backend {
        ""                 127.0.0.1:4431;
        ~(^|,)stun\.turn   127.0.0.1:4431;
        default            127.0.0.1:4430;
    }

    server {
        listen 443;
        listen [::]:443;
        ssl_preread on;
        proxy_pass $ff_backend;
        proxy_protocol on;          # справжня IP клієнта для ліміту запитів у HTTP
    }

    # TURN/TLS: nginx знімає TLS і передає звичайний TURN/TCP у coturn
    server {
        listen 127.0.0.1:4431 ssl proxy_protocol;
        ssl_certificate /etc/letsencrypt/live/__HOST__/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/__HOST__/privkey.pem;
        ssl_protocols TLSv1.2 TLSv1.3;
        proxy_pass __IP__:3478;
        proxy_timeout 30m;
    }
}
EOF
sed -i "s/__IP__/$IP/g; s/__HOST__/$HOST/g" /etc/nginx/sites-available/ff-turn /etc/nginx/stream.d/ff-turn.conf

# 8. nginx.conf: ліміти з'єднань і підключення stream
sed -i 's/^worker_processes auto;$/worker_processes auto;\nworker_rlimit_nofile 16384;/; s/worker_connections 768;/worker_connections 4096;/' /etc/nginx/nginx.conf
printf '\n# TURN поверх TLS на 443 (Firefighters)\ninclude /etc/nginx/stream.d/*.conf;\n' >> /etc/nginx/nginx.conf
nginx -t && systemctl reload nginx
systemctl enable nginx certbot.timer

# 9. Фаєрвол; avahi, якщо є
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 3478/udp
ufw allow 49152:65535/udp
ufw --force enable
systemctl disable --now avahi-daemon.service avahi-daemon.socket 2>/dev/null || true
```

Перевірка (усе має бути `active`, 200, втрат 0, dry-run успішний):
```bash
systemctl is-active coturn nginx php8.3-fpm certbot.timer
curl -s -o /dev/null -w "%{http_code}\n" https://$HOST/turn.php
J=$(curl -s https://$HOST/turn.php)
U=$(echo "$J" | python3 -c 'import sys,json;print(json.load(sys.stdin)["iceServers"][0]["username"])')
P=$(echo "$J" | python3 -c 'import sys,json;print(json.load(sys.stdin)["iceServers"][0]["credential"])')
timeout 20 turnutils_uclient -y -n 1 -m 1 -u "$U" -w "$P" $IP 2>&1 | grep "lost packets"            # UDP
timeout 20 turnutils_uclient -y -S -t -p 443 -n 1 -m 1 -u "$U" -w "$P" $IP 2>&1 | grep "lost packets"  # TLS 443
certbot renew --dry-run 2>&1 | tail -2
```
Сервер сигналізації (з клону репозиторію в `/root/firefighters`):
```bash
DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs node-ws
install -d -m 755 /opt/ff-signal
install -m 644 /root/firefighters/server/signal.mjs /opt/ff-signal/signal.mjs
sed "s/__IP__/$IP/g; s/__HOST__/$HOST/g" /root/firefighters/server/ff-signal.service > /etc/systemd/system/ff-signal.service
systemctl daemon-reload && systemctl enable --now ff-signal
# у /etc/nginx/sites-available/ff-turn: після limit_req_zone ffturn
#   limit_req_zone $binary_remote_addr zone=ffws:1m rate=30r/m;
# і перед `location / { return 404; }` у HTTPS-сервері:
#   location = /ws {
#       limit_req zone=ffws burst=20 nodelay;
#       limit_req_status 429;
#       proxy_pass http://127.0.0.1:8090;
#       proxy_http_version 1.1;
#       proxy_set_header Upgrade $http_upgrade;
#       proxy_set_header Connection "upgrade";
#       proxy_set_header X-Real-IP $remote_addr;
#       proxy_read_timeout 1h;
#       proxy_send_timeout 1h;
#   }
nginx -t && systemctl reload nginx
NODE_PATH=/usr/share/nodejs node -e "
const W = require('ws'); const s = new W('wss://$HOST/ws', { origin: 'https://iclimber.github.io', ALPNProtocols: ['http/1.1'] });  // без ALPN nginx відправить у TURN/TLS
s.on('open', () => s.send(JSON.stringify({ t: 'join', room: 'selfcheck', id: 'selfcheck01' })));
s.on('message', (m) => { console.log(String(m).slice(0, 60)); process.exit(0); });
setTimeout(() => { console.log('ТАЙМАУТ'); process.exit(1); }, 5000);"   # очікується welcome з непорожнім ice
```
Після цього в `index.html` замінити `SIGNAL_URL` на `wss://$HOST/ws`, закомітити й запушити; оновити IP і шляхи в розділі «Поточний стан». Якщо гра переїде з `https://iclimber.github.io`, змінити `FF_ORIGINS` у службі і `$allowed` у `turn.php`.

## Тестування
Реальну мережу з пісочниці перевірити не вдається, тому для тестів мережевий шар підмінявся заглушкою на BroadcastChannel (кілька вкладок у Playwright), а для мобільного керування — емуляція телефона з touch-подіями через CDP.
На VPS браузера немає, тому перевіряли в Node:
- логіка: `net.js` + скрипт гри в кількох `vm`-контекстах із фейковим DOM/canvas, віртуальним часом, справжньою логікою сервера (`createSignalServer`) і фейковими `WebSocket`/`RTCPeerConnection` (negotiated-канали, втрати й перестановки на ненадійному, переповнення каналу, блокування P2P-пар для неповного mesh, заморожування, вбивство без `bye`, обрив сокета сервером, зсув годинника, гравець з іншою версією, стара версія протоколу). Чутливість тестів перевірялась навмисними поломками `net.js`;
- наживо: справжній `ws`-сервер, справжній WebRTC (`node-datachannel`), Node `WebSocket` — вхід, перезаходи, вихід. У `node-datachannel` (libjuice) DataChannel з STUN відкривається ~1 с (чекає STUN / повторює першу ICE-перевірку), без STUN — десятки мс; у браузерах такого очікування немає.
- `signal.mjs` перевірено на Node 18.19.1 з `ws` із пакета `node-ws` (як на сервері).
