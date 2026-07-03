# ByTech Invoice Generator

React + Vite app. Two pages: **Home** (fill client + line items, generate PDF) and **Settings** (store your business/bank data once, auto-fills every invoice). Data is saved in the browser's localStorage — private to each device/browser.

## Run locally
```
npm install
npm run dev
```

## Deploy to Vercel
1. Push this folder to a GitHub repo.
2. In Vercel: **New Project** → import the repo.
3. Framework preset: **Vite** (auto-detected). Build command `npm run build`, output dir `dist` — Vercel fills these automatically.
4. Deploy.

Or via CLI:
```
npm i -g vercel
vercel
```

## Notes
- Invoice number is editable on the Home tab; if you type one you've already used, it auto-advances to the next free number when you click Generate PDF.
- PDF export uses `html2canvas` + `jsPDF`, both bundled — no server needed.
- UPI QR code is generated via `api.qrserver.com` at PDF-generation time (needs internet).
