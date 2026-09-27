# Картотека на облачном сервере

Сценарий: отдельный VPS с Ubuntu 24.04 LTS, публичным IPv4 и доменом вида `books.example.com`. После переноса библиотека доступна с телефона через интернет, домашний компьютер можно выключить. HTTPS выдаёт и обновляет Caddy, весь сайт и API закрыты логином и паролем. Установка локального сертификата на телефон не нужна.

В проекте подготовлены `compose.cloud.yaml`, `Caddyfile.cloud` и `.env.cloud.example`. Домашний запуск по `compose.yaml` остаётся отдельным.

## 1. Сервер и домен

Практический стартовый размер для личной библиотеки: 2 vCPU, 2 ГБ RAM, 20 ГБ SSD. Это ориентир, а не результат нагрузочного теста; место потребуется также для обложек и резервных копий. Выберите обычный VPS с постоянным диском: SQLite и обложки должны сохраняться между перезапусками.

В DNS домена создайте запись `A`: `books` → публичный IPv4 сервера. Ниже заменяйте `books.example.com` и `SERVER_IP` своими значениями. Если используется Cloudflare, для первого запуска выберите DNS only. Не создавайте `AAAA`, если IPv6 на сервере не настроен.

В сетевом экране облачного провайдера разрешите входящие TCP 80 и 443 всем, а SSH (обычно TCP 22) — со своего IP. Порты 3017, 5183, 5184 и 2019 открывать не нужно. Docker публикует только 80 и 443; не рассчитывайте только на UFW для ограничения опубликованных Docker-портов: [пояснение Docker](https://docs.docker.com/engine/network/packet-filtering-firewalls/).

Далее предполагается SSH-пользователь `ubuntu` с правами `sudo`. Если провайдер выдал другое имя, замените его в командах.

## 2. Docker на сервере

Подключитесь с компьютера:

```powershell
ssh ubuntu@SERVER_IP
```

Следующие команды выполняются **на сервере, в Bash**, на чистой Ubuntu:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl nano
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

sudo tee /etc/apt/sources.list.d/docker.sources > /dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker containerd
sudo docker compose version
sudo install -d -m 0755 -o "$(id -u)" -g "$(id -g)" /opt/kartoteka
```

Установка через официальный apt-репозиторий: [Docker для Ubuntu](https://docs.docker.com/engine/install/ubuntu/). Если Docker уже установлен и `sudo docker compose version` работает, повторная установка не нужна.

## 3. Перенос проекта и существующих книг

В отдельном **PowerShell на домашнем компьютере**:

```powershell
Set-Location C:\Workspace\library

tar -czf kartoteka-code.tar.gz Dockerfile .dockerignore compose.yaml compose.cloud.yaml Caddyfile.cloud .env.cloud.example package.json package-lock.json tsconfig.json vite.config.ts index.html src public server shared
if ($LASTEXITCODE -ne 0) { throw 'Не удалось упаковать проект' }

docker compose stop app
if ($LASTEXITCODE -ne 0) { throw 'Не удалось остановить приложение для копирования базы' }
try {
    tar -czf kartoteka-data.tar.gz data
    if ($LASTEXITCODE -ne 0) { throw 'Не удалось упаковать данные' }
} finally {
    docker compose start app
}

scp kartoteka-code.tar.gz kartoteka-data.tar.gz ubuntu@SERVER_IP:/opt/kartoteka/
```

На время упаковки приложение недоступно. Копируется вся папка `data`, включая возможные SQLite WAL-файлы: это согласованный снимок остановленной базы. Не добавляйте книги между этим снимком и переходом на облачный адрес, иначе изменения останутся только дома.

Теперь **на сервере**, до первого запуска облачного приложения:

```bash
cd /opt/kartoteka
tar -xzf kartoteka-code.tar.gz
tar -xzf kartoteka-data.tar.gz
sudo chown -R 1000:1000 /opt/kartoteka/data
```

UID 1000 — пользователь Node внутри контейнера. Если хотите начать с пустой библиотеки, пропустите архив данных и вместо его распаковки выполните `sudo install -d -m 0750 -o 1000 -g 1000 /opt/kartoteka/data`.

## 4. Домен и пароль

На сервере создайте хеш пароля. Команда интерактивно запросит пароль; используйте отдельный длинный пароль для библиотеки:

```bash
sudo docker run --rm -it caddy:2-alpine caddy hash-password
cp .env.cloud.example .env.cloud
chmod 600 .env.cloud
nano .env.cloud
```

Заполните файл:

```dotenv
LIBRARY_DOMAIN=books.example.com
ACME_EMAIL=your-email@example.com
LIBRARY_USER=owner
LIBRARY_PASSWORD_HASH='ВСТАВЬТЕ_ПОЛНЫЙ_ХЕШ_ИЗ_КОМАНДЫ'
GOOGLE_BOOKS_KEY=
```

Домен указывается без `https://`, порта и пути. В `LIBRARY_PASSWORD_HASH` нужен хеш, начинающийся с `$2`, а не сам пароль. Сохраните одинарные кавычки: они предотвращают подстановку `$` при чтении `.env` Compose. Ключ Google Books необязателен; если он был задан дома, перенесите его сюда отдельно.

Вход реализован через [Caddy basic_auth](https://caddyserver.com/docs/caddyfile/directives/basic_auth): браузер покажет стандартное окно логина и пароля. Это один общий доступ к личной библиотеке, без отдельных ролей пользователей. PWA сохраняет просмотренные данные в браузере; для общего или чужого телефона используйте приватный режим.

## 5. Запуск

На сервере:

```bash
cd /opt/kartoteka
sudo docker compose --env-file .env.cloud -f compose.cloud.yaml config --quiet
sudo docker compose --env-file .env.cloud -f compose.cloud.yaml up -d --build --wait --wait-timeout 180
sudo docker compose --env-file .env.cloud -f compose.cloud.yaml ps
sudo docker compose --env-file .env.cloud -f compose.cloud.yaml logs --tail 50 web
```

Используйте именно `-f compose.cloud.yaml`, без объединения с домашним Compose через второй `-f`.

Когда DNS уже указывает на VPS и 80/443 доступны извне, Caddy автоматически получает публичный сертификат и перенаправляет HTTP на HTTPS. Условия выдачи описаны в [документации Caddy](https://caddyserver.com/docs/automatic-https).

Проверьте на сервере или другом компьютере:

```bash
# Без пароля ожидается HTTP 401.
curl -I https://books.example.com

# Введите пароль по запросу; ожидается {"ok":true}.
curl -u owner https://books.example.com/api/health
```

Откройте **https://books.example.com** на Android, введите логин и пароль и разрешите камеру на странице сканера. Для проверки облачного доступа можно выключить Wi-Fi на телефоне и открыть сайт через мобильный интернет. Не устанавливайте домашний CA-сертификат для этого адреса.

На VPS Docker запускается при загрузке системы, оба контейнера имеют `restart: always`. Вход пользователя на сервер не требуется. После плановой перезагрузки проверьте адрес и `docker compose ... ps`.

После перехода используйте облачный адрес как основной: домашняя и облачная базы автоматически не синхронизируются. Старую домашнюю установку при желании остановите командой `docker compose down` в `C:\Workspace\library` — папка данных останется.

## 6. Обновления и резервные копии

Для обновления снова упакуйте и загрузите **только код**, распакуйте `kartoteka-code.tar.gz` в `/opt/kartoteka` и выполните:

```bash
cd /opt/kartoteka
sudo docker compose --env-file .env.cloud -f compose.cloud.yaml up -d --build --wait --wait-timeout 180
```

Не распаковывайте старый архив `kartoteka-data.tar.gz` поверх работающей облачной базы. Изменения домена или пароля в `.env.cloud` применяются той же командой, сборка для них необязательна.

Перед обновлением и регулярно делайте снимок данных. Следующий блок запускается на сервере из `/opt/kartoteka`, кратковременно останавливает приложение и запускает его обратно даже при ошибке архивации:

```bash
sudo bash <<'BASH'
set -euo pipefail
umask 077
cd /opt/kartoteka
mkdir -p /opt/kartoteka-backups
compose=(docker compose --env-file .env.cloud -f compose.cloud.yaml)
"${compose[@]}" stop app
trap '"${compose[@]}" start app' EXIT
tar -czf "/opt/kartoteka-backups/kartoteka-$(date -u +%Y%m%dT%H%M%SZ).tar.gz" data .env.cloud
BASH
```

Храните копию архива вне VPS, например в резервном хранилище провайдера: архив на том же диске не спасает при потере сервера. Архив содержит настройки доступа и возможный API-ключ, поэтому оставляйте его закрытым. Частоту снимков выберите по допустимой потере изменений, например раз в сутки; автоматическое расписание этой инструкцией не устанавливается.

Восстановление: остановите облачную установку (`docker compose --env-file .env.cloud -f compose.cloud.yaml down`), сохраните повреждённую папку `data` под другим именем и распакуйте выбранный архив в `/opt/kartoteka`. Не смешивайте старые WAL-файлы с восстановленной базой. Верните владельца `1000:1000` для `data`, права `600` для `.env.cloud` и выполните команду запуска из шага 5.

Сертификаты Caddy находятся в Docker volumes `cloud_caddy_data` и `cloud_caddy_config`; обычный `down` их сохраняет. Не добавляйте `-v` при штатных обновлениях. После потери volumes Caddy сможет перевыпустить сертификат при исправном DNS и доступных портах, но лучше сохранять volumes средствами резервного копирования VPS.

## Если не открылось

- Ошибка сертификата: проверьте DNS `A`/`AAAA`, входящие 80/443 и `logs --tail 100 web`. Статус `healthy` сам по себе не подтверждает выдачу публичного сертификата — это проверяет обращение к HTTPS-адресу.
- `401`: проверьте логин и пароль; в `.env.cloud` должен быть полный хеш в одинарных кавычках.
- `502` или нездоровый `app`: посмотрите `logs --tail 100 app`, права `data` и свободное место на диске.
- Сборка прерывается из-за памяти: увеличьте RAM VPS и повторите сборку.
- Пароль не запрашивается после посещения сайта: браузер мог сохранить HTTP Basic credentials или показать офлайн-кэш; проверяйте защиту командой `curl -I` без логина.
