# Clinic deployment — Hetzner CPX12 (2 GB) + Cloudflare

Server: `167.233.126.114` · App: `https://clinic.derops.dev` · API: `https://clinic-api.derops.dev`

Run the steps in order. Each ends with a **Check** — don't continue until it passes.
`laptop$` = your machine, `server$` = SSH session as your admin user.

---

## 0. What you need before starting

- The Cloudflare API token (Zone → DNS → Edit, limited to `derops.dev`).
- DNS already pointing at the server (done: `clinic`, `clinic-api`, `derops.dev`, `www`, `*`).
- This folder unzipped on your laptop at `~/dental-clinic/deploy`.

Add an SSH alias so every command below can just say `clinic`:

```bash
laptop$ cat >> ~/.ssh/config <<'CONF'
Host clinic
  HostName 167.233.126.114
  User ahmed
CONF
```

(Replace `ahmed` with the admin username you'll create in step 1.)

---

## 1. Harden the server (once, as root)

```bash
laptop$ scp deploy/server/01-harden.sh root@167.233.126.114:
laptop$ ssh root@167.233.126.114 'bash 01-harden.sh ahmed'
```

It updates the system, creates your admin user with your SSH key, disables root and
password logins, turns on the firewall (22/80/443 only), fail2ban, automatic security
updates, a 2 GB swap file, and installs Docker with log rotation.

**Check — in a NEW terminal, before closing the root one:**
```bash
laptop$ ssh clinic 'whoami && docker ps && free -h'
```
You should see your username, an empty container list, and `Swap: 2.0Gi`.

---

## 2. Supabase (trimmed for 2 GB)

```bash
# Sparse clone: the full repo is ~17k files and won't fit in /tmp (a RAM disk on Ubuntu 26.04)
server$ git clone --depth 1 --filter=blob:none --sparse https://github.com/supabase/supabase ~/supabase-src
server$ cd ~/supabase-src && git sparse-checkout set docker
server$ mkdir -p ~/supabase && cp -r ~/supabase-src/docker/. ~/supabase/
server$ cd ~/supabase && cp .env.example .env
server$ sh utils/generate-keys.sh --update-env
server$ sh utils/add-new-auth-keys.sh --update-env
```

Copy in the clinic files from your laptop:

```bash
laptop$ scp deploy/supabase/docker-compose.override.yml deploy/supabase/02-configure-env.sh clinic:~/supabase/
laptop$ ssh clinic 'mkdir -p ~/supabase/volumes/functions/staff'
laptop$ scp deploy/functions/staff/index.ts clinic:~/supabase/volumes/functions/staff/
```

Then:

```bash
server$ cd ~/supabase && bash 02-configure-env.sh
server$ docker compose pull
server$ docker compose up -d
```

**Important:** the official `.env` sets `COMPOSE_FILE=docker-compose.yml`, which makes
Docker silently ignore the override. `02-configure-env.sh` fixes that line — don't skip it.

`02-configure-env.sh` prints `SUPABASE_PUBLISHABLE_KEY` and `POSTGRES_PASSWORD`.
**Save both in your password manager now.** You'll need them in steps 4 and 5.

**Check:**
```bash
server$ docker compose ps --format 'table {{.Service}}\t{{.Status}}'
```
Exactly six services, all `Up`/`healthy`: `api-gw auth db functions rest storage`.
No realtime, studio, imgproxy or supavisor — those are intentionally off.

```bash
server$ free -h
```
"used" should be well under 1.5 GB.

---

## 3. Caddy (HTTPS for everything)

```bash
laptop$ ssh clinic 'sudo mkdir -p /srv/clinic /srv/derops && sudo chown $USER: /srv/clinic /srv/derops && mkdir -p ~/caddy'
laptop$ scp deploy/caddy/* deploy/caddy/.env.example clinic:~/caddy/
laptop$ scp deploy/site/index.html clinic:/srv/derops/
```

```bash
server$ cd ~/caddy && cp .env.example .env && nano .env     # paste CF_API_TOKEN, set ACME_EMAIL
server$ chmod 600 .env
server$ docker compose up -d --build
server$ docker compose logs -f caddy      # wait for "certificate obtained successfully", then Ctrl+C
```

Now in Cloudflare: **SSL/TLS → Overview → Full (strict)**.

**Check:**
```bash
laptop$ curl -sI https://derops.dev | head -1                          # 200
laptop$ curl -s https://clinic-api.derops.dev/ -o /dev/null -w '%{http_code}\n'   # 404 (dashboard hidden)
laptop$ curl -sI https://anything.derops.dev | grep -i location        # → https://derops.dev/
```

---

## 4. Database schema

```bash
laptop$ cd ~/dental-clinic
laptop$ read -rsp 'Postgres password: ' PGPASS; echo; export PGPASS
laptop$ SERVER=clinic bash deploy/supabase/db-push.sh; unset PGPASS
```

It opens an SSH tunnel to Postgres (never exposed publicly) and applies all 11 migrations.
**The demo `seed.sql` is not used in production.**

**Check:** the output lists all 11 migrations as applied, ending with
`20260929000000_marketing_contracts_commission.sql`.

---

## 5. The clinic and its owner

```bash
laptop$ scp -r deploy/server deploy/sql clinic:~/setup/
server$ bash ~/setup/server/03-create-owner.sh 'brother@email.com' 'د. الاسم' 'اسم العيادة'
```

It prints the owner's password **once**. Store it; your brother can change it later
from Settings → Team.

This creates the clinic, one chair, the drug catalog, the two ready-made prescriptions,
and the medical-history and consent forms.

---

## 6. The app

```bash
laptop$ cp deploy/web/.env.production.example web/.env.production
laptop$ nano web/.env.production        # paste SUPABASE_PUBLISHABLE_KEY
laptop$ cd web && SERVER=clinic bash ../deploy/web/deploy-web.sh
```

**Check — open https://clinic.derops.dev and sign in as the owner:**
1. Settings → Clinic: set the real hours, grace period, cash float.
2. Settings → Procedures: add the real price list.
3. Settings → Drugs: **your brother reviews every default dose.**
4. Settings → Team → Add staff: create the receptionist (tests the Edge Function).
5. Add a test patient, upload a photo (tests Storage), book an appointment,
   record a payment and print the receipt.
6. Delete the test data you don't want to keep (or keep it as a training patient).

To redeploy the app after any change: `SERVER=clinic bash ../deploy/web/deploy-web.sh`.

---

## 7. Backups (don't skip)

**On your laptop**, create the encryption key pair. The private key never goes on the server:

```bash
laptop$ mkdir -p ~/.config/clinic && age-keygen -o ~/.config/clinic/backup-key.txt
laptop$ grep 'public key' ~/.config/clinic/backup-key.txt      # copy the age1... value
```

Store `backup-key.txt` in your password manager too. **Without it, backups can't be read.**

Off-site storage: Cloudflare **R2** (free up to 10 GB). Create a bucket `clinic-backups`
and an R2 API token (Object Read & Write, that bucket only). Then:

```bash
server$ rclone config        # new remote "offsite", type s3, provider Cloudflare,
                             # access key + secret from the R2 token,
                             # endpoint https://<account-id>.r2.cloudflarestorage.com
server$ rclone lsd offsite:  # should list clinic-backups

server$ sudo mkdir -p /etc/clinic-backup
server$ sudo tee /etc/clinic-backup/env >/dev/null <<CONF
AGE_RECIPIENT=age1...your-public-key...
RCLONE_REMOTE=offsite:clinic-backups
SUPABASE_DIR=$HOME/supabase
HC_URL=
CONF
server$ sudo install -m 750 ~/setup/backup/backup.sh /usr/local/bin/clinic-backup
```

`HC_URL`: create a free check at healthchecks.io (period 1 day, grace 2 hours) and paste
its ping URL. You'll get an e-mail if a backup fails, doesn't run, or the disk passes 80%.

Nightly at 03:30 Cairo time (00:30 UTC):
```bash
server$ (crontab -l 2>/dev/null; echo '30 0 * * * sudo /usr/local/bin/clinic-backup') | crontab -
server$ sudo /usr/local/bin/clinic-backup     # run once now
```

**Check — the restore test, on your laptop (needs Docker, rclone with the same remote, age):**
```bash
laptop$ bash deploy/backup/restore-test.sh ~/.config/clinic/backup-key.txt offsite:clinic-backups
```
The row counts must match the live app. Repeat this monthly.

---

## 8. Monitoring

- **UptimeRobot** or **Better Stack** (free): HTTPS monitor on `https://clinic.derops.dev`,
  every 5 minutes, alerts to your e-mail/Telegram.
- **healthchecks.io**: backups and disk (step 7).

---

## Day-to-day

| Task | Command |
|---|---|
| Deploy app changes | `laptop$ cd web && SERVER=clinic bash ../deploy/web/deploy-web.sh` |
| New migration | `laptop$ SERVER=clinic PGPASS=… bash deploy/supabase/db-push.sh` |
| Update the staff function | `scp` it to `~/supabase/volumes/functions/staff/` then `docker compose restart functions` |
| Open Studio (admin UI) | `server$ cd ~/supabase && docker compose --profile admin up -d studio meta`, then `laptop$ ssh -L 8000:127.0.0.1:8000 clinic` and browse `http://localhost:8000` (dashboard login from `.env`). Stop it after: `docker compose stop studio meta` |
| Supabase logs | `server$ cd ~/supabase && docker compose logs --tail 100 <service>` |
| Memory check | `server$ free -h && docker stats --no-stream` |
| Check backups ran | `rclone lsf offsite:clinic-backups \| tail -4` |
| Need more RAM | Hetzner → server → Rescale → CPX22, **"CPU and RAM only"** (same IP, same data) |

## Security notes

- Postgres, the API gateway and Studio listen on `127.0.0.1` only. The internet sees
  ports 80/443 (Caddy) and 22 (SSH, key-only).
- Caddy exposes only `/rest/v1`, `/auth/v1`, `/storage/v1`, `/functions/v1`. The dashboard
  route returns 404.
- Public sign-up is disabled; accounts are created by the owner in Settings.
- The staff Edge Function only accepts browser calls from `https://clinic.derops.dev`.
- Backups are encrypted with a key the server doesn't have.
- Patient data is health data. Before real use, confirm with someone who knows Egypt's
  data-protection law whether hosting it in Germany is acceptable.
