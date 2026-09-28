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
- Один файл `index.html` (HTML + CSS + JS-модуль), без збірки. Хоститься на GitHub Pages.
- Мережа: WebRTC через Trystero (`https://esm.run/trystero@0.25.4`, стратегія Nostr за замовчуванням), `appId: 'yurii-firefighters-v1'`, `password: roomId` (шифрує SDP на публічних релеях).
- Кімната — хеш URL (`#roomId`); якщо його нема, генерується. Вхід у гру — просто за посиланням.
- Топологія mesh, але стан вогню авторитетний. Хост обирається так: спершу ті, в кого вже є гра (`hello.g`), далі менший штамп `t`, при рівності — менший id. Не беруть участі (поки є інші кандидати) ті, хто відійшов (вкладка прихована, `hello.a`) або мовчить довше `LIVE_MS` (3 с).
- Штамп `myStamp` — місце в черзі: спершу `Date.now()` при вході, далі тільки зростає (`restamp` = max відомих + 1) — після приєднання до чужої гри, повернення вкладки з фону і після заморожування сторінки (пауза таймерів > `RESUME_GAP_MS`). Тому зсув годинника новачка і «розморожений» старий хост не перехоплюють роль.
- Хост симулює вогонь за реальним часом (тіки по 0,25 с, догін не більше `MAX_CATCHUP`) і розсилає стан; при переході в фон одразу шле свіжий `world`, роль переходить наступному.
- Новий учасник чекає `GRACE_MS` (3 с) перед створенням власної гри; якщо приходить стан від хоста — приймає його. Якщо цей пристрій грав у цій кімнаті з іншими в межах `RECENT_ROOM_MS` (30 хв; `localStorage['ff-room:<roomId>']`, оновлюється раз на 5 с, коли є живі гравці), чекає `LONG_GRACE_MS` (20 с) з кнопкою «Почати без них».
- Пошук гравців: Trystero (Nostr) анонсує себе при вході (0, 233, 533, 1333 мс), далі раз на 60 с; анонси ефемерні (kind 20000–29999), підписка з `since: now()`. Хто пропустив анонс новачка (телефон у фоні, websocket перепідключався), знаходив його до хвилини — новачок тим часом починав власну гру. Тому, коли немає живого прямого сусіда (сусід із прихованою вкладкою вважається присутнім), гра перезаходить у кімнату (`rejoinRoom`: `leave()` + новий `joinRoom`, дії в `act` замінюються): через 10 с самотності, далі кожні 10 с до 1 хв, до 3 хв — кожні 20 с, потім раз на 60 с; а після повернення вкладки, події `online` чи розморожування сторінки — через `WAKE_CHECK_MS` (2,5 с), якщо ніхто живий не озвався. Перед перезаходом чекаємо, поки відкриється ≥ половина сокетів до релеїв (`getRelaySockets`, до 8 с): анонс у закритий сокет Trystero карає паузою анонсів на 60 с (`backoffRelay`). Перевірено на справжньому Trystero з релеями: без цього новачок чекав 51–58 с після пробудження іншого, з перезаходом — 1–2 с (а періодичний перезахід самотнього новачка — ~6 с).
- Позиції гравців: кожен сам розсилає свою ~20 Гц, у інших — згладжування. Гравця, від якого немає повідомлень `LIVE_MS`, не малюють і не рахують; хто відійшов — напівпрозорий.
- Вихід: на `pagehide` — `bye` і `room.leave()`; отримувачі одразу видаляють гравця і ігнорують його подальші повідомлення. `pageshow` з bfcache і `hashchange` — перезавантаження.
- Неповний mesh: кожен у `hello.n` повідомляє прямих сусідів. Отримане напряму від X (`hello`, `pos`, `world`, `bye`) пересилається через `fwd` сусідам без прямого зв'язку з X; пересилає лише спільний сусід із найменшим id. Новому сусідові ретранслятор одразу шле останні `hello` недосяжних для нього гравців. Адресні `douse`/`restart` до хоста без прямого з'єднання йдуть через спільного сусіда (один стрибок).
- Машини не передаються мережею: розклад детермінований від хешу roomId і спільного часу `sharedNow() = Date.now() + clockOffset`. Хост розсилає свій `sharedNow()` у `world.ht`, решта оцінює зсув як максимум `ht - Date.now()`; новий хост зберігає свій зсув, тому при зміні хоста машини не стрибають.
- TURN: перед `joinRoom` паралельно `fetch` облікових даних (таймаут 4 с) і перевірка UDP (є srflx-кандидат від STUN, до 2,5 с). Через `rtcPolyfill` offer-з'єднання з пулу Trystero (20 шт.) створюються без TURN, TURN вмикається (`setConfiguration`) лише для з'єднання, що відповідає на offer; якщо UDP не проходить — TURN у всіх з'єднаннях. Інакше кожна вкладка тримала б ~40 алокацій.
- Усі вхідні повідомлення перевіряються (типи, межі, довжина сітки); хост приймає `douse`, лише якщо за останньою `pos` гравець має повне відро і стоїть на цій ділянці або сусідній. Від навмисного обману хостом у P2P захисту немає.
- `requestAnimationFrame` викликається на початку кадру; `rr` малює через `arcTo` (без `ctx.roundRect`).
- Зіткнення з машиною кожен гравець визначає локально для себе, прапорець оглушення йде в `pos`.

### Повідомлення (Trystero actions)
- `hello` `{t (штамп), a (away), g (є гра), n (прямі сусіди)}` — при вході/виході сусідів, зміні стану і раз на 5 с.
- `pos` `{x, y, h (hue), f (face), b (full), m (moving), s (stunned), q (номер, відкидаються старі)}`.
- `world` `{r (round), g (рядок сітки), a (вік вогню по ділянках), p (phase: play|win|lose), ht (sharedNow хоста)}` — від хоста при змінах і раз на секунду.
- `douse` `{r, i}` — клієнт → хост; клієнт оптимістично гасить локально (`pending`), хост перевіряє і підтверджує.
- `restart` `{r}` — клієнт → хост.
- `bye` `{}` — при закритті сторінки.
- `fwd` `{k (тип), o (автор), to? (адресат), d (дані)}` — ретрансляція.

### Світ
Координати світу 900 × 600, клітинка 60, масштабування під екран з letterbox. Основні константи на початку скрипта: `BURN_TIME`, `SPREAD_RATE`, `START_FIRES`, `SPEED`, `CAR_SPEED`, `CAR_SLOT`, `CAR_CHANCE`, `STUN_MS`, `LIVE_MS`, `RESUME_GAP_MS`, `MAX_CATCHUP`, `LONG_GRACE_MS`, `RECENT_ROOM_MS`, `WAKE_CHECK_MS`.

## Поточний стан
- Гра працює і опублікована на GitHub Pages; мобільне керування працює.
- TURN налаштований на VPS 144.172.110.72 (Ubuntu 24.04):
  - coturn: `/etc/turnserver.conf`, 3478 UDP/TCP, relay 49152–65535 UDP, `use-auth-secret`, `denied-peer-ip` для приватних мереж, `total-quota=2000`, `user-quota=100`, `max-bps=64000`, `bps-capacity=6250000`, `no-tcp-relay`.
  - TURN/TLS на 443: nginx `stream` (`/etc/nginx/stream.d/ff-turn.conf`, модуль `libnginx-mod-stream`) ділить 443 за ALPN: без ALPN або `stun.turn` → `127.0.0.1:4431` (nginx знімає TLS і шле TURN/TCP у coturn 3478), решта → HTTPS на `127.0.0.1:4430` з `proxy_protocol` (справжня IP через `real_ip_header proxy_protocol`).
  - Секрет: `/etc/ff-turn/secret` (root:www-data 640), його читають coturn (у конфігу) і PHP.
  - Ендпоінт: `https://144-172-110-72.sslip.io/turn.php` (`/var/www/ff-turn/turn.php`, nginx `/etc/nginx/sites-available/ff-turn`), `limit_req` 6/хв + burst 10 з IP. Облікові дані на 24 год з унікальним ім'ям `<expiry>:<random>` на кожен запит; URL `turn:144.172.110.72:3478?transport=udp` і `turns:144-172-110-72.sslip.io:443?transport=tcp`. CORS лише для `https://iclimber.github.io`. Сертифікат Let's Encrypt, автопродовження `certbot.timer` (nginx при продовженні перезавантажується, stream підхоплює новий сертифікат).
  - Гра перед `joinRoom` отримує `iceServers` (див. «TURN» в архітектурі); при помилці — без TURN і з попередженням у HUD.
- Автозапуск: `coturn`, `nginx`, `php8.3-fpm`, `certbot.timer` увімкнені в systemd; для coturn drop-in `/etc/systemd/system/coturn.service.d/override.conf` (`After=network-online.target`, `Restart=on-failure`), бо він прив'язаний до конкретної IP.
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
Після цього в `index.html` замінити `TURN_URL` на `https://$HOST/turn.php`, закомітити й запушити; оновити IP і шляхи в розділі «Поточний стан». Якщо гра переїде з `https://iclimber.github.io`, змінити `$allowed` у `turn.php`.

## Тестування
Реальну мережу з пісочниці перевірити не вдається, тому для тестів мережевий шар підмінявся заглушкою на BroadcastChannel (кілька вкладок у Playwright), а для мобільного керування — емуляція телефона з touch-подіями через CDP.
На VPS браузера немає: мережеву логіку перевіряли в Node — скрипт гри в кількох `vm`-контекстах із фейковим DOM/canvas і фейковим Trystero (блокування пар для неповного mesh, заморожування, вбивство без `bye`, зсув годинника).
Поведінку самого Trystero/релеїв перевіряли в Node зі справжнім `trystero@0.25.4` і WebRTC-поліфілом `node-datachannel` (окремі процеси-учасники; «сон» — SIGSTOP плюс закриття сокетів через `pauseRelayReconnection` і `getRelaySockets()`).
