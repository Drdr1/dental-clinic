# Test server — test.dentano.app

A separate copy of Dentano on its own server (`5.222.9.10`), with a made-up clinic.
Nothing here touches the live clinic or its patients. Delete the server when testing is done.

App: `https://test.dentano.app` · API: `https://test-api.dentano.app`

`laptop$` = your machine, `server$` = SSH session on the test server.

---

## 0. DNS (Cloudflare → dentano.app → DNS)

Two A records pointing at `5.222.9.10`, **DNS only (grey cloud)**, not proxied:

| Name       | Content      | Proxy    |
|------------|--------------|----------|
| `test`     | `5.222.9.10` | DNS only |
| `test-api` | `5.222.9.10` | DNS only |

SSH alias on your laptop:

```bash
laptop$ cat >> ~/.ssh/config <<'CONF'
Host dentano-test
  HostName 5.222.9.10
  User ahmed
CONF
```

---

## 1. Harden (once, as root)

```bash
laptop$ cd ~/dental-clinic && git checkout v2-design && git pull
laptop$ scp deploy/server/01-harden.sh root@5.222.9.10:
laptop$ ssh root@5.222.9.10 'bash 01-harden.sh ahmed'
```

**Check, in a new terminal:** `ssh dentano-test 'whoami && docker ps && free -h'` shows
`ahmed`, an empty list and `Swap: 2.0Gi`.

---

## 2. Supabase

```bash
server$ git clone --depth 1 --filter=blob:none --sparse https://github.com/supabase/supabase ~/supabase-src
server$ cd ~/supabase-src && git sparse-checkout set docker
server$ mkdir -p ~/supabase && cp -r ~/supabase-src/docker/. ~/supabase/
server$ cd ~/supabase && cp .env.example .env
server$ sh utils/generate-keys.sh --update-env
server$ sh utils/add-new-auth-keys.sh --update-env
```

```bash
laptop$ scp deploy/supabase/docker-compose.override.yml deploy/supabase/02-configure-env.sh dentano-test:~/supabase/
laptop$ ssh dentano-test 'mkdir -p ~/supabase/volumes/functions/staff'
laptop$ scp deploy/functions/staff/index.ts dentano-test:~/supabase/volumes/functions/staff/
```

```bash
server$ cd ~/supabase && bash 02-configure-env.sh https://test.dentano.app https://test-api.dentano.app
server$ docker compose pull && docker compose up -d
```

Save the printed `SUPABASE_PUBLISHABLE_KEY` and `POSTGRES_PASSWORD` in your password
manager under "Dentano test". They are different from the live server's.

**Check:** `docker compose ps` shows six services up: `api-gw auth db functions rest storage`.

---

## 3. Caddy

```bash
laptop$ ssh dentano-test 'sudo mkdir -p /srv/clinic /srv/derops && sudo chown $USER: /srv/clinic /srv/derops && mkdir -p ~/caddy'
laptop$ scp deploy/caddy/docker-compose.yml deploy/caddy/Dockerfile deploy/staging/Caddyfile dentano-test:~/caddy/
```

```bash
server$ cd ~/caddy && printf 'ACME_EMAIL=ahmeddarder157@gmail.com\nCF_API_TOKEN=\n' > .env && chmod 600 .env
server$ docker compose up -d --build
server$ docker compose logs -f caddy     # wait for "certificate obtained successfully" twice, then Ctrl+C
```

**Check:** `curl -s https://test-api.dentano.app/ -o /dev/null -w '%{http_code}\n'` prints `404`.

---

## 4. Database and the test clinic

```bash
laptop$ cd ~/dental-clinic
laptop$ read -rsp 'Test Postgres password: ' PGPASS; echo; export PGPASS
laptop$ SERVER=dentano-test bash deploy/supabase/db-push.sh; unset PGPASS
```

Then the made-up clinic. Pick a password for the three test logins (not one you use anywhere else):

```bash
laptop$ scp deploy/staging/seed-test-clinic.sql dentano-test:
server$ read -rsp 'Password for the test logins: ' TESTPW; echo
server$ docker exec -i supabase-db psql -U postgres -d postgres -v pw="$TESTPW" < ~/seed-test-clinic.sql; unset TESTPW
```

It ends with `Test clinic ready: 40 patients, … appointments, 16 plans.`
It refuses to run if a clinic already exists, so it can never land on the live server.

---

## 5. The app

```bash
laptop$ cd ~/dental-clinic/web
laptop$ printf 'VITE_SUPABASE_URL=https://test-api.dentano.app\nVITE_SUPABASE_PUBLISHABLE_KEY=\n' > .env.staging
laptop$ nano .env.staging      # paste the test SUPABASE_PUBLISHABLE_KEY
laptop$ SERVER=dentano-test MODE=staging bash ../deploy/web/deploy-web.sh
```

Open `https://test.dentano.app` and sign in:

| Login                         | Role                    |
|-------------------------------|-------------------------|
| `owner@test.dentano.app`      | صاحب العيادة (ودكتور)   |
| `doctor@test.dentano.app`     | دكتورة                  |
| `reception@test.dentano.app`  | استقبال                 |

The public pages work too: booking at `https://test.dentano.app/book/demo`.

---

## Notes

- **Not on the test server:** the AI assistant and voice dictation need API keys, so they are off here unless you add them.
- **Updating after new code:** pull, then rerun `db-push.sh` (step 4, first part) and `deploy-web.sh` (step 5).
- **Starting over with fresh data:** in `~/supabase`, `docker compose down && sudo rm -rf volumes/db/data`, then `docker compose up -d` and step 4 again.
- **When done:** delete the server in Hetzner and the two DNS records. Billing is hourly.
