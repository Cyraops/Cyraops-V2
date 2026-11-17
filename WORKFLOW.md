# Development & Promotion Workflow

This is your **non-production (duplicate) environment** for testing features, bug fixes, or website design changes safely before publishing them to `cyraops.com`.

---

## Environment Comparison

| Feature | Production (Live) | Non-Production (Dev/Testing) |
| :--- | :--- | :--- |
| **Folder** | `Desktop/locally hosted app` | `Desktop/locally hosted app dev` |
| **Local URL** | `http://localhost:3000` | `http://localhost:3001` |
| **Public Domain** | `https://www.cyraops.com` | Internal only (`localhost:3001`) |
| **Database** | PostgreSQL `company_os` | PostgreSQL `company_os_dev` |
| **Setup Key** | `6d00942bc0bb5f0497fabe76b194cb2cca1adc8334184e3d` | `dev-setup-key-cyraops-2026` |

---

## How to Test Features in Dev

1. **Start the Dev Server (if not already running):**
   ```bash
   cd "$HOME/Desktop/locally hosted app dev"
   npm run start          # Or "npm run dev" for hot-reloading
   ```
2. **Open in Browser:**
   - Website preview: [http://localhost:3001](http://localhost:3001)
   - CRM setup: [http://localhost:3001/setup](http://localhost:3001/setup) *(Setup Key: `dev-setup-key-cyraops-2026`)*
   - CRM login: [http://localhost:3001/login](http://localhost:3001/login)

3. **Editing the Marketing Website:**
   - Source code is in `marketing-source/src`.
   - After making changes to the marketing pages, re-sync to dev with:
     ```bash
     npm run build:marketing
     ```

---

## How to Push to Production (Public Website)

When you are happy with your changes in this dev environment and want them live on `www.cyraops.com`:

```bash
cd "$HOME/Desktop/locally hosted app dev"
./promote-to-prod.sh
```
*(Or run `npm run promote`)*

### What the promotion script does automatically:
1. Runs automated unit tests and TypeScript checks.
2. Builds the marketing website from source.
3. Syncs code files safely into production (never overwrites production `.env` or uploaded user files).
4. Runs database migrations on the production database.
5. Builds and restarts the live production server on port 3000.
6. Runs health checks and confirms live deployment.

