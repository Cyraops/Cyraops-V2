# CyraOps

CyraOps is a single-page site for managed AWS cloud operations for startups and small businesses. The visual direction uses warm editorial typography, a restrained green palette, and a custom Three.js infrastructure sculpture.

## Run locally

```bash
npm install
npm run dev
```

Create a production bundle with `npm run build`, then serve it with `npm run preview`.

## Contact form

The form submits to the combined app's same-origin `/api/public/inquiries` route. Accepted inquiries are saved as new CRM leads for the Owner to review. Keep the website and CMS on the same host so the relative endpoint reaches the application.
